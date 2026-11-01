# Development workflow

Make a focused commit for each completed, tested change: feature, bug fix, test coverage, or documentation. Commit messages describe actual behavior. Do not create empty commits or split a working change solely to increase contribution counts.

Before pushing, review staged files and exclude secrets, imported user documents, local database/storage state, screenshots containing user evidence, and generated build files. Keep `.env.example` free of real values.

Run TypeScript checks and tests relevant to the change. Database and browser checks require the local services; report checks that could not run. Hosting stays paused unless explicitly requested.
