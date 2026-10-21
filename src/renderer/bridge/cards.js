// How the Bridge orders its cards, shared by the dashboard and the actions
// that follow it (tiling from the toolbar or the palette).

export const TILE_LAYOUT_LABELS = [
  ["grid", "Grid"],
  ["columns", "Columns"],
  ["rows", "Rows"],
  ["main", "Main + stack"],
];

// The repository a card works in, by the last segment of its directory.
export function projectOf(card) {
  const cwd = card.cwd ?? "";
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? "—";
}

// Live and saved cards in one list so they can be ordered together. Manual
// order comes from state.json; cards it does not mention follow, newest first.
export function orderCards(cards, order, sort) {
  const recency = (card) => card.lastSeenAt ?? card.startedAt ?? 0;
  if (sort === "profile") {
    return [...cards].sort((a, b) => a.profileName.localeCompare(b.profileName) || recency(b) - recency(a));
  }
  if (sort === "project") {
    return [...cards].sort(
      (a, b) =>
        projectOf(a).localeCompare(projectOf(b)) ||
        a.profileName.localeCompare(b.profileName) ||
        recency(b) - recency(a),
    );
  }
  if (sort === "recent") return [...cards].sort((a, b) => recency(b) - recency(a));
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...cards].sort((a, b) => {
    const ra = rank.get(a.id) ?? Infinity;
    const rb = rank.get(b.id) ?? Infinity;
    return ra - rb || recency(b) - recency(a);
  });
}

export function liveCard(session) {
  return {
    kind: "live",
    id: session.id,
    profileName: session.profile.name,
    cwd: session.profile.cwd,
    startedAt: session.startedAt,
    session,
  };
}

// A session running on another machine that shares the data folder. It
// orders with the local cards but is drawn from the other machine's
// presence, so there is no window here to focus or tile.
export function remoteCard(host, session) {
  return {
    kind: "remote",
    id: session.id,
    profileName: session.profileName,
    cwd: session.cwd,
    startedAt: session.startedAt,
    host,
    session,
  };
}

// A saved card from another machine's state file. Its transcript lives
// there, so it can only be looked at from here.
export function remoteDormantCard(host, entry) {
  const remote = { ...entry, remote: true, hostId: host.id, hostOnline: host.online, foreignHost: host.name };
  return { kind: "dormant", ...remote, entry: remote, host };
}

// Every live session, in the order the Bridge shows it when unfiltered.
export function liveIdsInOrder(state) {
  const sort = state.settings.layout?.sort ?? "manual";
  return orderCards(state.sessions.map(liveCard), state.order, sort).map((card) => card.id);
}
