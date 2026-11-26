"""Server-side Gemini adapter with one deadline-bounded transient generation retry."""
import http.client
import json
import os
from pathlib import Path
import re
import time
from observability import observed

# Verified against metadata, token counting and the real CV generation path.
MODEL = os.getenv('GEMINI_MODEL', 'gemini-3.5-flash-lite')
HOST = 'generativelanguage.googleapis.com'


class ProviderError(RuntimeError):
    def __init__(self, code, retry_after=None):
        self.code = code
        self.retry_after = retry_after
        super().__init__(code)


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate JSON key')
            result[key] = value
        return result
    def invalid_constant(value):
        raise ValueError('nonfinite JSON value')
    return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid_constant)


class GeminiClient:
    def __init__(self, api_key=None, model=MODEL):
        if api_key is None:
            api_key = os.getenv('GEMINI_API_KEY')
            if not api_key:
                path = Path(__file__).resolve().parents[2] / '.local/gemini-key.txt'
                try:
                    if path.stat().st_size > 512:
                        raise ProviderError('invalid_key_file')
                    api_key = path.read_text(encoding='utf-8-sig').strip()
                except (OSError, UnicodeError) as exc:
                    raise ProviderError('provider_not_configured') from exc
        if not isinstance(api_key, str) or not 1 <= len(api_key) <= 512 or not re.fullmatch(r'[\x21-\x7e]+', api_key):
            raise ProviderError('invalid_credentials')
        if not isinstance(model, str) or not re.fullmatch(r'gemini-[a-zA-Z0-9.-]{1,100}', model):
            raise ProviderError('invalid_model')
        self._key, self.model = api_key, model
        self._limits_cache = None

    def _request(self, action, payload, deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ProviderError('provider_timeout')
        body = None if payload is None else json.dumps(payload, ensure_ascii=True, separators=(',', ':')).encode()
        if body is not None and len(body) > 1_048_576:
            raise ProviderError('provider_request_size')
        operation_limit = 90 if action == 'generateContent' else 30
        connection = http.client.HTTPSConnection(HOST, timeout=min(remaining, operation_limit))
        try:
            path = '/v1beta/models/' + self.model + (':' + action if action else '')
            connection.request('GET' if body is None else 'POST', path, body=body,
                headers={'x-goog-api-key': self._key, 'Content-Type': 'application/json'})
            response = connection.getresponse()
            if response.status != 200:
                if response.status in (408, 504):
                    raise ProviderError('provider_timeout')
                # Never surface provider bodies, URLs containing keys, or authentication details.
                hint=response.getheader('Retry-After')
                retry_after=int(hint) if isinstance(hint,str) and re.fullmatch(r'[0-9]{1,6}',hint) else None
                raise ProviderError('provider_http_' + str(response.status),retry_after)
            data = bytearray()
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ProviderError('provider_timeout')
                if connection.sock is not None:
                    connection.sock.settimeout(min(remaining, operation_limit))
                chunk = response.read1(min(8192, 262145 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
                if len(data) > 262144:
                    raise ProviderError('provider_response_size')
            value = strict_json(data)
            if not isinstance(value, dict):
                raise ProviderError('invalid_provider_response')
            return value
        except TimeoutError as exc:
            raise ProviderError('provider_timeout') from exc
        except (OSError, http.client.HTTPException) as exc:
            raise ProviderError('provider_unavailable') from exc
        except (ValueError, UnicodeError) as exc:
            raise ProviderError('invalid_provider_response') from exc
        finally:
            connection.close()

    def limits(self, deadline):
        now = time.monotonic()
        if now >= deadline:
            raise ProviderError('provider_timeout')
        if self._limits_cache is not None:
            model, expires, limits = self._limits_cache
            if model == self.model and now < expires:
                return limits
        value = self._request('', None, deadline)
        if value.get('name') != 'models/' + self.model or any(type(value.get(k)) is not int or value[k] < 1
                for k in ('inputTokenLimit', 'outputTokenLimit')):
            raise ProviderError('invalid_model_metadata')
        methods = value.get('supportedGenerationMethods', [])
        if not isinstance(methods, list) or not {'generateContent', 'countTokens'} <= set(methods):
            raise ProviderError('unsupported_model')
        limits = value['inputTokenLimit'], value['outputTokenLimit']
        self._limits_cache = (self.model, time.monotonic() + 300, limits)
        return limits

    def count(self, request, deadline):
        value = self._request('countTokens', {'generateContentRequest': {
            'model': 'models/' + self.model, **request}}, deadline)
        count = value.get('totalTokens')
        if type(count) is not int or count < 1:
            raise ProviderError('invalid_token_count')
        return count

    @observed('generation')
    def generate(self, request, deadline):
        for attempt in range(2):
            try:
                return self._request('generateContent', request, deadline)
            except ProviderError as exc:
                if attempt or exc.code not in {'provider_http_429','provider_http_503'}:
                    raise
                delay=max(1,exc.retry_after if exc.retry_after is not None else (30 if exc.code=='provider_http_429' else 2))
                if delay+5 >= deadline-time.monotonic():
                    raise
                time.sleep(delay)
