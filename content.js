function waitForElement(selector) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

(async () => {
  // Step 1 — validate URL and extract edition + game slug
  const urlMatch = window.location.href.match(
    /^https:\/\/ldjam\.com\/events\/ludum-dare\/([^/?#]+)\/([^/?#]+)/
  );
  if (!urlMatch) return;

  const ludumDareNumber = urlMatch[1];
  const gameName = urlMatch[2];

  await waitForElement("#comment-undefined");

  // Step 2 — resolve the node id of the current game
  const walkRes = await fetch(
    `https://api.ldjam.com/vx/node2/walk/1/events/ludum-dare/${ludumDareNumber}/${gameName}`
  ).then((r) => r.json());

  const gameId = walkRes.node_id;
  if (!gameId) return;

  // Fetch the logged-in user's id from the last avatar link in the page
  const avatarEl = [...document.querySelectorAll("a.button-base.button-link.-avatar[href^='/users/']")].at(-1);
  console.log("[LudumExtension] avatarEl href:", avatarEl?.getAttribute("href") ?? "introuvable");
  const myUsername = avatarEl?.getAttribute("href")?.split("/users/")[1] ?? null;
  let myId = null;
  if (myUsername) {
    const myWalkRes = await fetch(
      `https://api.ldjam.com/vx/node2/walk/1/users/${myUsername}/games`
    ).then((r) => r.json());
    myId = myWalkRes.node_id ?? null;
  }
  console.log("[LudumExtension] myUsername:", myUsername, "| myId:", myId);

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

    injectSpinners(authorId, authorToCommentIds);

    const authorGame = await findGameInEdition(authorId, ludumDareNumber);
    removeSpinners(authorId, authorToCommentIds);

    if (authorGame) {
      console.log("[LudumExtension] authorGame trouvé:", authorGame.gameName, "| gameId:", authorGame.gameId, "| myId:", myId);
      const alreadyCommented = myId ? await hasUserCommented(authorGame.gameId, myId) : false;
      injectGameCard(authorId, authorGame, authorToCommentIds, alreadyCommented);
    }
  }
})();

let _debugLogged = false;

async function hasUserCommented(gameId, userId) {
  const res = await fetch(`https://api.ldjam.com/vx/comment/getbynode/${gameId}`).then((r) => r.json());
  const comments = res.comment ?? [];
  if (!_debugLogged) {
    console.log("[LudumExtension] debug comments du premier jeu trouvé:", comments);
    console.log("[LudumExtension] myId:", userId);
    _debugLogged = true;
  }
  return comments.some((c) => c.author === userId);
}

function getLastSpan(commentId) {
  const commentEl = document.getElementById(`comment-${commentId}`);
  if (!commentEl) return null;
  const titleEl = commentEl.querySelector(".-title");
  return titleEl?.lastElementChild ?? null;
}

function injectSpinners(authorId, authorToCommentIds) {
  for (const commentId of authorToCommentIds.get(authorId) ?? []) {
    const lastSpan = getLastSpan(commentId);
    if (!lastSpan) continue;
    const spinner = document.createElement("span");
    spinner.dataset.ludumSpinner = commentId;
    spinner.style.cssText = "display:inline-block;vertical-align:middle;margin-left:8px;";
    spinner.innerHTML = `<span style="line-height:0;transform-origin:50% 50%;animation:nav-spinner 2s linear infinite;display:inline-block;"><svg class="svg-icon icon-spinner" style="filter:drop-shadow(0 0 1px rgba(0,0,0,0.5));overflow:visible;"><use xlink:href="#icon-spinner"></use></svg></span>`;
    lastSpan.insertAdjacentElement("afterend", spinner);
  }
}

function removeSpinners(authorId, authorToCommentIds) {
  for (const commentId of authorToCommentIds.get(authorId) ?? []) {
    document.querySelector(`[data-ludum-spinner="${commentId}"]`)?.remove();
  }
}

function injectGameCard(authorId, game, authorToCommentIds, alreadyCommented) {
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
    label.textContent = game.gameName + (alreadyCommented ? " ✅" : "");
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
