(async () => {
  // Step 1 — validate URL and extract edition + game slug
  const urlMatch = window.location.href.match(
    /^https:\/\/ldjam\.com\/events\/ludum-dare\/([^/?#]+)\/([^/?#]+)/
  );
  if (!urlMatch) return;

  const ludumDareNumber = urlMatch[1];
  const gameName = urlMatch[2];

  // Step 2 — resolve the node id of the current game
  const walkRes = await fetch(
    `https://api.ldjam.com/vx/node2/walk/1/events/ludum-dare/${ludumDareNumber}/${gameName}`
  ).then((r) => r.json());

  const gameId = walkRes.node_id;
  if (!gameId) return;

  // Step 3 — fetch all comments on this game
  const commentsRes = await fetch(
    `https://api.ldjam.com/vx/comment/getbynode/${gameId}`
  ).then((r) => r.json());

  const comments = commentsRes.comment ?? [];

  // Build a map authorId -> [commentId, ...] to know which divs to update
  const authorToCommentIds = new Map();
  for (const comment of comments) {
    const list = authorToCommentIds.get(comment.author) ?? [];
    list.push(comment.id);
    authorToCommentIds.set(comment.author, list);
  }

  // Steps 4-8 — for every unique commenter, find their game and inject it immediately
  const seenAuthors = new Set();

  for (const comment of comments) {
    const authorId = comment.author;
    if (seenAuthors.has(authorId)) continue;
    seenAuthors.add(authorId);

    const authorGame = await findGameInEdition(authorId, ludumDareNumber);
    if (authorGame) {
      injectGameCard(authorId, authorGame, authorToCommentIds);
    }
  }
})();

function injectGameCard(authorId, game, authorToCommentIds) {
  const commentIds = authorToCommentIds.get(authorId) ?? [];
  for (const commentId of commentIds) {
    const commentEl = document.getElementById(`comment-${commentId}`);
    if (!commentEl) continue;

    const titleEl = commentEl.querySelector(".-title");
    if (!titleEl) continue;

    const lastSpan = titleEl.lastElementChild;
    if (!lastSpan) continue;

    const card = document.createElement("a");
    card.href = game.gameUrl;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.style.cssText = [
      "display:inline",
      "align-items:center",
      "gap:10px",
      "margin-top:10px",
      "padding:6px 10px 6px 6px",
      "text-decoration:none",
      "color:inherit",
      "font-size:0.85em",
      "font-weight:600",
      "transition:background 0.15s",
    ].join(";");

    card.addEventListener("mouseenter", () => {
      card.style.background = "rgba(255,255,255,0.12)";
    });
    card.addEventListener("mouseleave", () => {
      card.style.background = "rgba(255,255,255,0.06)";
    });

    const entryLabel = document.createElement("span");
    entryLabel.textContent = "| Game Entry: ";
    card.appendChild(entryLabel);

    if (game.imageUrl) {
      const img = document.createElement("img");
      img.src = game.imageUrl;
      img.alt = game.gameName;
      img.style.cssText =
        "width:48px;height:48px;object-fit:cover;border-radius:3px;flex-shrink:0;margin-right: 3px;";
      card.appendChild(img);
    }

    const label = document.createElement("span");
    label.textContent = game.gameName;
    card.appendChild(label);

    lastSpan.insertAdjacentElement("afterend", card);
  }
}

async function findGameInEdition(authorId, ludumDareNumber) {
  const pathFragment = `/ludum-dare/${ludumDareNumber}/`;
  const limit = 24;
  let offset = 0;

  while (true) {
    const feedRes = await fetch(
      `https://api.ldjam.com/vx/node/feed/${authorId}/authors/item/game?limit=${limit}&offset=${offset}`
    ).then((r) => r.json());

    const feed = feedRes.feed ?? [];
    if (feed.length === 0) break;

    for (const entry of feed) {
      const nodeRes = await fetch(
        `https://api.ldjam.com/vx/node2/get/${entry.id}`
      ).then((r) => r.json());

      const node = nodeRes.node?.[0];
      if (!node?.path) continue;

      if (node.path.includes(pathFragment)) {
        const rawCover = node.meta?.cover ?? "";
        const imageUrl = rawCover
          ? `https://static.jam.host${rawCover.replace(/^\/\/\//, "/")}.480x384.fit.jpg`
          : null;

        return {
          authorId,
          gameId: node.id,
          gameName: node.name,
          gameUrl: `https://ldjam.com${node.path}`,
          imageUrl,
        };
      }
    }

    offset += feed.length;
  }

  return null;
}
