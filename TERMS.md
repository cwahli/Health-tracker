# Conditions d'utilisation — agent Google Workspace store

**Canonical page:** [https://health-tracking.duckdns.org/terms](https://health-tracking.duckdns.org/terms) — served from the project's own domain. This file
is the source of truth for its content and edit history. Companion to
[PRIVACY.md](./PRIVACY.md).

## Who these terms cover

The agents in this repository (the Telegram bots, the worker agents, and the council
runner) when they write to the Google Workspace store described in
[PRIVACY.md](./PRIVACY.md).

## The account owner's responsibilities

- The Google account that authorizes the fleet is the owner of everything the store
  holds. Its owner is responsible for that account's security, including any
  multi-factor authentication and recovery methods configured on it.
- The owner decides who else is shared into the store's folder, and may remove that
  access at any time.
- The owner is responsible for the accuracy of the data the agents record, including
  reviewing generated summaries before relying on them.
- The owner may delete any object in the store. The agents never delete anything the
  store did not create in the same run.

## The agents' commitments

- Append-only writes. A cell or file is never edited in place; corrections are added
  as new rows or new objects.
- Credentials stay on the hosts and never enter the store.
- Writes are content-addressed, so a retry cannot silently overwrite an earlier
  artefact.
- If the store cannot be reached, the agents say so rather than pretending the write
  happened.

## No warranty

The store and the agents that write to it are provided as-is, with no guarantee of
completeness, accuracy or availability. The agents are automated; their summaries
are drafts for a human to check.

## Acceptable use

The store is for this project's own operational records. It must not be used to store
credentials, personal data beyond what a turn already contains, or anything whose
distribution the account owner has not authorized.

## Contact

`cwah.liu@gmail.com`
