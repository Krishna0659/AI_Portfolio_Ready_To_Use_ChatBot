import test from 'node:test';
import assert from 'node:assert/strict';
import {httpFailure} from '../services/fetch-broker/errors';
test('GitHub quota 403 waits until its reset rather than claiming access denied',()=>{const now=1700000000000;const e=httpFailure(403,'api.github.com',{'x-ratelimit-remaining':'0','x-ratelimit-reset':'1700000600'},now);assert.equal(e.code,'RATE_LIMITED');assert.equal(e.retryAt?.getTime(),now+601000);});
test('access denied is terminal and not bypassed',()=>{const e=httpFailure(403,'example.com',{},0);assert.equal(e.code,'ACCESS_DENIED');assert.equal(e.retryAt,null);});
test('retry-after takes precedence and is bounded',()=>{assert.equal(httpFailure(429,'example.com',{'retry-after':'120'},0).retryAt?.getTime(),120000);assert.equal(httpFailure(429,'example.com',{'retry-after':'999999999'},0).retryAt?.getTime(),86400000);});
test('missing repository is distinct from quota and transient server failures',()=>{assert.equal(httpFailure(404,'api.github.com',{}).code,'NOT_FOUND');assert.ok(httpFailure(503,'api.github.com',{}).retryAt);});
