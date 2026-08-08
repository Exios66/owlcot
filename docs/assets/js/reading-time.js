/* Owlcot — estimated reading time for journal entries.
 * Runs only on real entry pages (badge reads "ENTRY #NNN") and counts words
 * from the article body, excluding headings, tag chips, edit button, the
 * "Written by" footer and the git source-file facts.
 */
(function () {
  "use strict";
  var badge = document.querySelector(".entry-meta .entry-badge");
  if (!badge || !/^ENTRY\b/i.test(badge.textContent || "")) return;

  var meta = badge.closest(".entry-meta");
  if (!meta || document.querySelector("[data-reading-time]")) return;

  var article = document.querySelector(".md-content__inner.md-typeset");
  if (!article) return;

  var clone = article.cloneNode(true);
  ["h1", ".md-tags", ".md-content__button", ".md-source-file", ".entry-meta"]
    .forEach(function (selector) {
      clone.querySelectorAll(selector).forEach(function (node) {
        node.remove();
      });
    });
  clone.querySelectorAll("p").forEach(function (p) {
    if (/^Written by\b/i.test(p.textContent.trim())) p.remove();
  });

  var text = clone.textContent || "";
  var words = text.trim().split(/\s+/).filter(Boolean).length;
  var minutes = Math.max(1, Math.round(words / 200));

  var el = document.createElement("span");
  el.className = "reading-time";
  el.setAttribute("data-reading-time", "");
  el.textContent = "~" + minutes + " min read";
  meta.appendChild(el);
})();
