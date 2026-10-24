(function (root) {
  "use strict";

  const DETAIL_PATH = "/webtoon/detail";
  const PAID_WORDS = ["미리보기", "유료", "쿠키", "대여", "구매"];

  function parseEpisodeUrl(value, base) {
    try {
      const url = new URL(value, base || "https://comic.naver.com");
      if (
        url.protocol !== "https:" ||
        url.hostname !== "comic.naver.com" ||
        url.port ||
        url.username ||
        url.password ||
        url.pathname !== DETAIL_PATH
      )
        return null;
      const titleId = url.searchParams.get("titleId");
      const episode = Number(url.searchParams.get("no"));
      if (
        !/^\d+$/.test(titleId || "") ||
        !Number.isSafeInteger(episode) ||
        episode < 1
      )
        return null;
      return { titleId, episode, url: url.href };
    } catch (_) {
      return null;
    }
  }

  function isPaidText(text) {
    const normalized = String(text || "").replace(/\s+/g, " ");
    return PAID_WORDS.some((word) => normalized.includes(word));
  }

  function getPageInfo(doc, locationLike) {
    const parsed = parseEpisodeUrl(locationLike.href);
    if (!parsed) return { supported: false };
    const title =
      doc
        .querySelector("h2.EpisodeViewer__heading--IZ7QX, .comicinfo h2, h1")
        ?.textContent?.trim() ||
      doc
        .querySelector('meta[property="og:title"]')
        ?.content?.split("-")[0]
        ?.trim() ||
      doc.title.split("-")[0].trim();
    const episodeTitle =
      doc
        .querySelector(
          ".EpisodeViewer__title--U5PAX, .view h3, [class*='episode'] [class*='title']",
        )
        ?.textContent?.trim() || `${parsed.episode}화`;
    return {
      supported: true,
      site: "naver",
      seriesId: parsed.titleId,
      episode: parsed.episode,
      title,
      episodeTitle,
    };
  }

  function getImages(doc) {
    const selectors = [
      '#sectionContWide img[id^="content_image_"]',
      "#sectionContWide img",
      "#comic_view_area img",
    ];
    for (const selector of selectors) {
      const images = [...doc.querySelectorAll(selector)].filter((img) => {
        const rect = img.getBoundingClientRect();
        return (
          !img.closest("a, .episode_list") &&
          (img.naturalHeight > 100 ||
            rect.height > 100 ||
            /^content_image_/.test(img.id || ""))
        );
      });
      if (images.length) return images;
    }
    return [];
  }

  function getScrollElement(doc) {
    return doc.scrollingElement || doc.documentElement;
  }

  function inspectNext(doc, locationLike) {
    const current = parseEpisodeUrl(locationLike.href);
    if (!current) return { ok: false, reason: "unsupported" };

    const stateScript = [...doc.querySelectorAll("script")]
      .map((script) => script.textContent || "")
      .find((text) => /nextArticle\s*:/.test(text));
    if (stateScript) {
      const block =
        stateScript.match(/nextArticle\s*:\s*\{([\s\S]*?)\}/)?.[1] || "";
      const series = block.match(/\btitleId\s*:\s*['"“]?(\d+)/)?.[1];
      if (series && series !== current.titleId)
        return { ok: false, reason: "no-next" };
      const episode = Number(block.match(/\bno\s*:\s*['\"]?(\d+)/)?.[1]);
      const paid = /\bcharge\s*:\s*true\b/.test(block);
      const blocked = /\bblindInspection\s*:\s*true\b/.test(block);
      if (paid || blocked) return { ok: false, reason: "paid-or-locked" };
      if (
        /\bcharge\s*:\s*false\b/.test(block) &&
        /\bblindInspection\s*:\s*false\b/.test(block) &&
        Number.isInteger(episode) &&
        episode > current.episode
      ) {
        const url = new URL(locationLike.href);
        url.searchParams.set("no", String(episode));
        return { ok: true, url: url.href, episode };
      }
    }

    const explicit = [...doc.querySelectorAll("a.link_next, a[class*='next']")]
      .map((link) => ({
        link,
        parsed: parseEpisodeUrl(link.href, locationLike.href),
      }))
      .find(
        ({ parsed }) =>
          parsed &&
          parsed.titleId === current.titleId &&
          parsed.episode > current.episode,
      );
    const listed = [...doc.querySelectorAll(".episode_list a")]
      .map((link) => ({
        link,
        parsed: parseEpisodeUrl(link.href, locationLike.href),
      }))
      .filter(
        ({ parsed }) =>
          parsed &&
          parsed.titleId === current.titleId &&
          parsed.episode > current.episode,
      )
      .sort((a, b) => a.parsed.episode - b.parsed.episode)[0];
    const next = explicit || listed;

    if (!next) return { ok: false, reason: "no-next" };
    const { link, parsed } = next;
    const context = [
      link.textContent,
      link.getAttribute("aria-label"),
      link.getAttribute("title"),
      link.className,
      link.parentElement?.textContent,
    ].join(" ");
    const disabled =
      link.getAttribute("aria-disabled") === "true" ||
      link.hasAttribute("disabled") ||
      /disabled|locked/i.test(link.className);
    if (disabled || isPaidText(context))
      return { ok: false, reason: "paid-or-locked" };
    if (!/(?:무료|free)/i.test(context))
      return { ok: false, reason: "unknown-free" };
    return { ok: true, url: parsed.url, episode: parsed.episode };
  }

  const api = {
    parseEpisodeUrl,
    isPaidText,
    getPageInfo,
    getImages,
    getScrollElement,
    inspectNext,
  };
  root.WebtoonAdapters = root.WebtoonAdapters || {};
  root.WebtoonAdapters.naver = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
