---
id: "77"
slug: "sso-group-project-mapping"
date: "2026-08-12"
title: "Map IdP Groups To Project Access"
summary: "SCIM-provisioned members can now get project access from their directory groups: map an Entra ID or Okta group to one or more projects, and access follows group membership automatically — granted when they join the group, revoked when they leave. Available on the Enterprise plan."
image:
  src: "/changelog/sso-group-project-mapping.png"
  alt: "A circuit board with a glowing group-of-people emblem on the central chip linked to project folders, representing directory groups mapped to project access"
  width: 1536
  height: 1024
---

SCIM provisioning already creates and removes members automatically, but which projects a developer could see was still a manual step: everyone landed on the organization's default projects, and anything more specific meant editing each member by hand on the Team page. **Group → project access mapping** closes that gap: map a directory group to one or more projects, and project access follows group membership in your identity provider.

## Set It Up Once, Then Manage Access In Your Directory

On the **SSO** page, the new **Group project access** card takes a group name and a set of projects. From then on, moving people in and out of that group in Entra ID (or pushing groups in Okta) is all it takes — the gateway re-derives their access on every directory sync.

![The Group project access card on the SSO settings page with a group mapped to a project](/changelog/sso-group-project-mapping-card.png)

## Predictable Sync Rules

| Rule                               | Behavior                                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Mapped groups replace the defaults | A member of at least one mapped group gets exactly the union of their groups' mapped projects; everyone else keeps the default project access   |
| Re-synced on every directory event | Provisioning, reactivation, membership changes, group renames and deletions — leaving a mapped group revokes its projects on the next sync      |
| Manual grants always survive       | Project access granted by an admin on the Team page is never touched by the sync                                                                |
| Exact name matching                | Mappings match the group's display name exactly as your IdP pushes it; saving a mapping for an existing group replaces that group's project set |

The **Default project access** selection is now authoritative too: saving an empty selection means members in no mapped group get no project access at all (deny by default — also the starting state for newly created organizations), instead of silently falling back to the organization's first project.

Existing organizations are unaffected until they add a mapping or save the default selection: current members' grants are treated as manual, so nothing is revoked retroactively, and organizations that never saved the default selection keep the first-project fallback.

Only the **developer** role is scoped this way — owners and admins keep access to every project. Available on the **Enterprise plan**.

---

**[Entra setup guide →](https://docs.llmgateway.io/features/sso/entra)** | **[Okta setup guide →](https://docs.llmgateway.io/features/sso/okta)**
