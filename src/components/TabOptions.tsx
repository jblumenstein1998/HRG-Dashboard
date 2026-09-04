"use client";

import { TAB_LABELS, type Tab } from "@/lib/users/tabs";

/**
 * The options inside the header's tab picker.
 *
 * Only the `<option>` list is shared, not the `<select>` around it — each tab
 * styles its own header differently, and lifting the whole control would mean
 * reconciling five sets of classes for no benefit. What matters is that the
 * *contents* have one definition: this used to be five hardcoded copies, which
 * is why hiding a single entry once took a five-file change.
 *
 * `tabs` comes from the signed-in user's position, resolved server-side, so the
 * picker never offers a tab the guard would then bounce them out of.
 */
export default function TabOptions({ tabs, isAdmin }: { tabs: Tab[]; isAdmin: boolean }) {
  return (
    <>
      {tabs.map((t) => (
        <option key={t} value={t}>
          {TAB_LABELS[t]}
        </option>
      ))}
      {isAdmin && <option value="/admin">Users &amp; Access</option>}
      {isAdmin && <option value="/admin/workstream-links">Workstream Links</option>}
    </>
  );
}
