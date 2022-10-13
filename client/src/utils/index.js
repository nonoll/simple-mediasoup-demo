export function sortPeers(peers) {
  return Object.entries(peers)
    .map(([id, info]) => ({
      id,
      joinTs: info.joinTs,
      media: { ...info.media },
    }))
    .sort((a, b) => (a.joinTs > b.joinTs ? 1 : b.joinTs > a.joinTs ? -1 : 0));
}
