![ScopeLint: checks every pull request against your statement of work, automatically](docs/screenshots/title-card.png)

# ScopeLint

ScopeLint lints code changes against the contract. It compares a pull-request diff with the repository's `scope.md` statement of work, classifies each functional area as in scope, out of scope, or a gray area, and drafts a client-ready change order when work falls outside the agreement.

## The problem

Scope creep quietly erodes project margins: teams do useful work that was never priced, while clients lose a clear record of what changed. ScopeLint makes the contract part of pull-request review, so questionable work is visible before it is merged.

## Quickstart: replay mode (no API key)

```sh
git clone <owner>/scopelint
cd scopelint
npm install
npx scopelint init
npx scopelint check --diff-file fixtures/diffs/pr2-admin-dashboard.diff --replay
```

Replay mode reads the canned response paired with the diff filename, so it is useful for demos and CI-free evaluation. The final command prints an out-of-scope verdict and a draft change order without contacting the OpenAI API.

## Live mode setup

Create a local `.env` file (it is ignored by Git) with your API key:

```text
OPENAI_API_KEY=your_key_here
```

Then run a live check:

```sh
npx scopelint check --diff-file fixtures/diffs/pr2-admin-dashboard.diff
```

ScopeLint uses `gpt-5.6-terra` by default. Pass `--model <id>` to choose a different compatible model.

To run ScopeLint automatically for pull requests, grant the workflow permission to update pull-request comments:

```yaml
name: ScopeLint
on: pull_request
permissions:
  pull-requests: write
  contents: read
jobs:
  scopelint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: <owner>/scopelint@main
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The action fetches the pull-request diff, posts one marked ScopeLint comment, and updates that same comment on later runs. Use its `scope-path`, `fail-on`, and `model` inputs as needed.

## Demo repository walkthrough

`scopelint-demo-acme` is the companion Express API project. Its staged pull requests demonstrate an in-scope points-accrual feature, an out-of-scope admin analytics endpoint, and a mixed accrual/payment-adapter change. The exported diffs and replay responses live in this repository under `fixtures/`.

The demo project is available beside this repository at `../scopelint-demo-acme`, with these branches ready to open as pull requests:

- `feat/points-accrual-engine`
- `feat/admin-analytics-dashboard`
- `fix/accrual-rounding-payment-adapter`

## How it works

```mermaid
flowchart LR
  A[scope.md contract] --> C[ScopeLint classifier]
  B[Pull request diff] --> C
  C --> D[Terminal verdict]
  C --> E[Pull request comment]
  C --> F[Optional scope ledger]
```

## Built with Codex and GPT-5.6

ScopeLint was built end-to-end in a single primary Codex session, staged deliberately
across six phases: project skeleton and offline replay mode, live GPT-5.6 classification,
GitHub Actions integration, the scope ledger, tests and documentation, and finally the
Acme demo project used in this submission's live pull requests. A short second session
generated and staged the demo repository's branches.

Codex accelerated the build most visibly in three places: scaffolding the composite
GitHub Action (`action.yml`) and its PR-comment update logic, generating the structured
JSON schema validation and retry handling for the classifier, and producing the three
matched diff/canned-response fixture pairs used in ScopeLint's zero-API-key replay mode.

The build wasn't one-shot. Mid-session, Codex initially reported creating the GitHub
Actions caller workflow file when it hadn't actually written it to disk, caught only
when the file was missing from a live pull request check. Effort level was also tuned
down for templated stages (README, tests) and kept high for structurally complex ones
(the Action, the demo repo), to manage Codex credit usage across the full build.

The classifier itself runs on `gpt-5.6-terra`, chosen for its balance of structured
reasoning and cost on a per-pull-request classification task.

Codex session ID: `019f7b1b-5a14-7420-81c7-774cfa15a943`

![ScopeLint verdict comment on a pull request](docs/screenshots/Verdict-comment1.png)
![ScopeLint verdict comment on a pull request](docs/screenshots/Verdict-comment2.png)
![ScopeLint running automatically in GitHub Actions](docs/screenshots/Actions-passing.png)

## Roadmap

- Hosted dashboard and multi-repository views
- Authentication and persistent hosted storage
- Jira and Slack integrations
- IDE extensions
- Team analytics for recurring out-of-scope work

## License

MIT. See [LICENSE](LICENSE).
