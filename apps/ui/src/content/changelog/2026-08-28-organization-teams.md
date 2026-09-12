---
id: "84"
slug: "organization-teams"
date: "2026-08-28"
title: "Organization Teams and Directory Sync"
summary: "Group developers under one shared policy — a project ceiling, per-developer budgets, and IAM rules — instead of configuring each person by hand. Microsoft Entra groups map onto teams over SCIM, and a default team catches everyone who joins without one. Available on the Enterprise plan."
image:
  src: "/changelog/organization-teams.png"
  alt: "Organization teams: developer figures grouped under one glowing policy shield on a circuit board, with a directory sync arrow feeding into it"
  width: 1536
  height: 1024
---

Onboarding a developer into an enterprise organization has meant repeating the same steps by hand: grant the right projects, cap their key count and spend, attach the IAM rules everyone on that squad needs, then hope the next person gets identical treatment. **Organization teams** replace that with one policy object. Assign a developer to a team and they inherit all of it.

## One Team, Four Controls

Open **Team → Teams**, create a team, then open it to configure:

| Control                   | What it does                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project ceiling**       | The projects the team may reach. Effective access is the intersection of this list and the developer's own grants, so a team narrows and never widens. Select none and that member's keys return `403`. |
| **Per-developer budgets** | Caps each member's active key count, lifetime spend, and recurring spend. Personal and per-key limits still apply and may be stricter.                                                                  |
| **IAM policy**            | Shared model, provider, pricing, and IP rules. Member-level and key-level rules run afterward and can only narrow further.                                                                              |
| **Developers**            | Assign, move, or unassign members. A move swaps the policy immediately.                                                                                                                                 |

A developer belongs to at most one team, and owners and admins never inherit team policy. Unassigning restores that person's personal project, IAM, and budget settings.

## Default Team

Mark one team as the organization's default and anyone joining as a developer lands in it — through an invite, a direct add, SSO domain auto-join, SCIM provisioning, or a demotion from admin. When you enable the flag you can also assign every currently unassigned developer in one step. Moving or clearing it later changes where future joins land. Existing members keep their team until a SCIM membership or group-mapping sync recomputes them, at which point anyone the default placed follows the new default. The point is that nobody lands in the organization outside a policy while somebody remembers to assign them.

## Entra Groups over SCIM

If you already model squads as Microsoft Entra security groups, map them rather than maintaining membership twice. Under **SSO**, map an Entra group name to a team; once that group is in the SCIM provisioning scope, matching developers are assigned as membership changes, and removing someone from the group removes the synced assignment.

Precedence is deterministic. An explicit manual assignment survives directory changes. An owner or admin role mapping clears team membership entirely. When several mapped groups apply, the alphabetically first group name wins, and the default team sits below both. Manually unassigning a synced developer lasts only until the next SCIM update.

Team, membership, budget, IAM, and directory-sync changes are all recorded in [audit logs](https://docs.llmgateway.io/learn/audit-logs).

Creating teams and editing policy requires the **Enterprise plan**. If Enterprise access lapses, existing policy stays enforced and reviewable — you can still unassign developers and delete empty teams.

---

**[Team docs →](https://docs.llmgateway.io/learn/team)** | **[Configure Entra SCIM →](https://docs.llmgateway.io/features/sso/entra)**
