
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

function cleanupInjectedElements() {
  document.querySelectorAll('[data-ludum-spinner], [data-ludum-card]').forEach(el => el.remove());
}

const pageState = {
  initialized: false,
  url: null,
  myId: null,
  gameId: null,
  authorToGame: new Map(),
};

async function runExtension() {
  // Step 1 — validate URL and extract edition + game slug
  const urlMatch = window.location.href.match(
    /^https:\/\/ldjam\.com\/events\/ludum-dare\/([^/?#]+)\/([^/?#]+)/
  );
  if (!urlMatch) {
    return;
  }

  const ludumDareNumber = urlMatch[1];
  const gameName = urlMatch[2];

  // Clean up previous injections
  cleanupInjectedElements();

  await waitForElement("#comment-undefined");

  // Step 2 — resolve the node id of the current game
  const walkRes = await fetch(
    `https://api.ldjam.com/vx/node2/walk/1/events/ludum-dare/${ludumDareNumber}/${gameName}`
  ).then((r) => r.json());

  const gameId = walkRes.node_id;
  if (!gameId) return;

  // Fetch the logged-in user's id from the last avatar link in the page
  const avatarEl = [...document.querySelectorAll("a.button-base.button-link.-avatar[href^='/users/']")].at(-1);
  const myUsername = avatarEl?.getAttribute("href")?.split("/users/")[1] ?? null;
  let myId = null;
  if (myUsername) {
    const myWalkRes = await fetch(
      `https://api.ldjam.com/vx/node2/walk/1/users/${myUsername}/games`
    ).then((r) => r.json());
    myId = myWalkRes.node_id ?? null;
  }

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

  const authorToGame = new Map();

  // Steps 4-8 — process all unique commenters in parallel
  const seenAuthors = new Set();
  const uniqueComments = comments.filter(({ author }) => {
    if (seenAuthors.has(author)) return false;
    seenAuthors.add(author);
    return true;
  });

  uniqueComments.forEach(({ author }) => injectSpinners(author, authorToCommentIds));

  await Promise.all(uniqueComments.map(async ({ author: authorId }) => {
    const authorGame = await findGameInEdition(authorId, ludumDareNumber);
    removeSpinners(authorId, authorToCommentIds);

    if (authorGame) {
      authorToGame.set(authorId, authorGame);
      const alreadyCommented = myId ? await hasUserCommented(authorGame.gameId, myId) : false;
      injectGameCard(authorId, authorGame, authorToCommentIds, alreadyCommented);
    }
  }));

  pageState.initialized = true;
  pageState.url = window.location.href;
  pageState.myId = myId;
  pageState.gameId = gameId;
  pageState.authorToGame = authorToGame;
}

(async () => {
  
  // Attendre que le document soit vraiment prêt au premier chargement
  if (document.readyState === 'loading') {
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));
  }
  
  // Run initially
  await runExtension();

  // Listen for URL changes (for SPA navigation)
  let currentUrl = window.location.href;

  // Override pushState and replaceState to dispatch custom events
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function(state, title, url) {
    const result = originalPushState.apply(this, arguments);
    window.dispatchEvent(new CustomEvent('locationchange', { detail: { url } }));
    return result;
  };

  history.replaceState = function(state, title, url) {
    const result = originalReplaceState.apply(this, arguments);
    window.dispatchEvent(new CustomEvent('locationchange', { detail: { url } }));
    return result;
  };

  const handleUrlChange = async () => {
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      await runExtension();
    }
  };

  window.addEventListener('popstate', handleUrlChange);
  window.addEventListener('locationchange', handleUrlChange);

  // Poll URL in case navigation happens without history events
  setInterval(handleUrlChange, 250);

  // Listen for tab visibility changes
  window.addEventListener('visibilitychange', async () => {
    if (!document.hidden) {
      if (pageState.initialized && pageState.url === window.location.href) {
        await refreshChecks();
      } else {
        await runExtension();
      }
    }
  });
})();

let _debugLogged = false;

async function hasUserCommented(gameId, userId) {
  const res = await fetch(`https://api.ldjam.com/vx/comment/getbynode/${gameId}`).then((r) => r.json());
  const comments = res.comment ?? [];
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
    card.dataset.ludumCard = 'true';
    card.dataset.ludumAuthor = authorId;
    card.dataset.ludumGameId = game.gameId;
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
    label.dataset.ludumLabel = 'true';
    label.dataset.ludumBaseName = game.gameName;
    label.textContent = game.gameName + (alreadyCommented ? " ✅" : "");
    card.appendChild(label);

    lastSpan.insertAdjacentElement("afterend", card);
  }
}

function updateGameCardCheck(authorId, alreadyCommented) {
  const cards = document.querySelectorAll(`a[data-ludum-card][data-ludum-author="${authorId}"]`);
  for (const card of cards) {
    const label = card.querySelector('[data-ludum-label]');
    if (!label) continue;
    const baseName = label.dataset.ludumBaseName ?? label.textContent.replace(/\s*✅$/, "");
    label.dataset.ludumBaseName = baseName;
    label.textContent = baseName + (alreadyCommented ? " ✅" : "");
  }
}

async function refreshChecks() {
  if (!pageState.initialized || !pageState.myId) return;
  for (const [authorId, game] of pageState.authorToGame) {
    // Vérifier si c'était déjà checké avant
    const cards = document.querySelectorAll(`a[data-ludum-card][data-ludum-author="${authorId}"]`);
    const wasAlreadyChecked = Array.from(cards).some(card => {
      const label = card.querySelector('[data-ludum-label]');
      return label && label.textContent.includes('✅');
    });

    if (!wasAlreadyChecked) {
      const alreadyCommented = await hasUserCommented(game.gameId, pageState.myId);
      updateGameCardCheck(authorId, alreadyCommented);
    }
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
