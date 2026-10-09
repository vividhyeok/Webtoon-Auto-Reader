const test = require("node:test");
const assert = require("node:assert/strict");
const { parseEpisodeUrl, isPaidText, inspectNext } = require("../content/adapters/naver.js");

function link(href, text = "다음화", className = "link_next") {
  return {
    href,
    textContent: text,
    className,
    parentElement: { textContent: text },
    getAttribute(name) { return name === "aria-disabled" ? "false" : null; },
    hasAttribute() { return false; }
  };
}

function documentWith({ next = [], listed = [], scripts = [] } = {}) {
  return {
    querySelectorAll(selector) {
      if (selector === "script") return scripts.map((textContent) => ({ textContent }));
      if (selector.includes("link_next")) return next;
      if (selector === ".episode_list a") return listed;
      return [];
    }
  };
}

test("네이버 상세 회차 URL을 파싱한다", () => {
  assert.deepEqual(
    parseEpisodeUrl("https://comic.naver.com/webtoon/detail?titleId=849279&no=15&week=sun"),
    {
      titleId: "849279",
      episode: 15,
      url: "https://comic.naver.com/webtoon/detail?titleId=849279&no=15&week=sun"
    }
  );
});

test("지원하지 않는 URL과 잘못된 회차를 거부한다", () => {
  assert.equal(parseEpisodeUrl("https://example.com/webtoon/detail?titleId=1&no=2"), null);
  assert.equal(parseEpisodeUrl("https://comic.naver.com/webtoon/detail?titleId=1&no=x"), null);
});

test("유료 회차 관련 표시를 보수적으로 감지한다", () => {
  assert.equal(isPaidText("쿠키 2개로 미리보기"), true);
  assert.equal(isPaidText("다음화"), false);
});

test("사이트가 제공한 실제 다음 회차 링크를 선택한다", () => {
  const current = { href: "https://comic.naver.com/webtoon/detail?titleId=849279&no=15&week=sun" };
  const result = inspectNext(documentWith({
    next: [link("https://comic.naver.com/webtoon/detail?titleId=849279&no=16&week=sun")]
  }), current);
  assert.equal(result.ok, true);
  assert.equal(result.episode, 16);
});

test("네이버 페이지 상태의 실제 다음 회차와 charge 값을 우선한다", () => {
  const current = { href: "https://comic.naver.com/webtoon/detail?titleId=849279&no=15&week=sun" };
  const free = inspectNext(documentWith({
    scripts: ["nextArticle: { no: '18', charge: false, blindInspection: false }"]
  }), current);
  assert.equal(free.ok, true);
  assert.equal(free.episode, 18);
  const paid = inspectNext(documentWith({
    scripts: ["nextArticle: { no: '16', charge: true, blindInspection: false }"]
  }), current);
  assert.equal(paid.ok, false);
  assert.equal(paid.reason, "paid-or-locked");
});

test("유료 표시가 있는 다음 회차와 다른 작품 링크를 거부한다", () => {
  const current = { href: "https://comic.naver.com/webtoon/detail?titleId=1&no=15" };
  const paid = inspectNext(documentWith({
    next: [link("https://comic.naver.com/webtoon/detail?titleId=1&no=16", "쿠키로 미리보기")]
  }), current);
  assert.equal(paid.ok, false);
  assert.equal(paid.reason, "paid-or-locked");
  const other = inspectNext(documentWith({
    next: [link("https://comic.naver.com/webtoon/detail?titleId=2&no=16")]
  }), current);
  assert.equal(other.reason, "no-next");
});
