/** Pure, event-scoped Staff directory projection and change planning. No credentials. */
export const STAFF_ROLES = Object.freeze(['scorekeeper','bracket_manager','organizer']);
const EMAIL = /^[^@\s<>]{1,64}@[^@\s<>]{1,190}$/;
export const staffEmail = value => typeof value === 'string' && EMAIL.test(value.trim()) ? value.trim().toLowerCase() : null;

export function directoryFromSnapshots(events, snapshots, remote = []) {
  const byEmail = new Map();
  for (const entry of remote) {
    const email = staffEmail(entry.email);
    if (!email || typeof entry.name !== 'string' || entry.name.length > 120) continue;
    byEmail.set(email, {email, name: entry.name.trim() || email, verified: entry.verified === true,
      provisioned: entry.provisioned === true, assignments: {}});
  }
  const valid = new Set(events.filter(e => e.role === 'organizer' && e.lifecycle !== 'archived').map(e => e.eventId));
  for (const [eventId, snap] of Object.entries(snapshots)) {
    if (!valid.has(eventId)) continue;
    for (const member of snap?.staff ?? []) {
      // Revoked identities without a directory profile are omitted. Their history remains in the database.
      if (!member.active || !STAFF_ROLES.includes(member.role)) continue;
      const email = staffEmail(member.email);
      if (!email) continue;
      const person = byEmail.get(email) ?? {email, name: email, verified: true, provisioned: true, assignments: {}};
      person.assignments[eventId] = member.role;
      byEmail.set(email, person);
    }
  }
  return Object.freeze([...byEmail.values()].sort((a,b)=>a.name.localeCompare(b.name))
    .map(p => Object.freeze({...p, assignments: Object.freeze({...p.assignments})})));
}

/** All updates are explicit per-event grants or revocations; never silently touch other events. */
export function planStaffChange(person, selected, role, manageableEvents) {
  if (!STAFF_ROLES.includes(role)) throw new Error('invalid-role');
  if (!Array.isArray(selected) || !Array.isArray(manageableEvents)) throw new Error('invalid-events');
  const allowed = new Set(manageableEvents.filter(e=>e.role==='organizer'&&e.lifecycle!=='archived').map(e=>e.eventId));
  const target = new Set(selected);
  if (target.size !== selected.length || [...target].some(id=>!allowed.has(id))) throw new Error('out-of-scope');
  const current = person?.assignments ?? {};
  if (Object.keys(current).some(id=>!allowed.has(id))) throw new Error('unknown-existing-scope');
  const revoke = Object.keys(current).filter(id=>!target.has(id));
  const grant = [...target].filter(id=>current[id]!==role);
  return Object.freeze({revoke: Object.freeze(revoke), grant: Object.freeze(grant), role,
    changed: Boolean(revoke.length || grant.length)});
}
