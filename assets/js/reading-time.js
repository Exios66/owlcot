/* Owlcot — estimated reading time for journal entries.
 * Reads the rendered article text, counts words, and appends
 * "· ~N min read" to the entry meta row.
 */
(function () {
  "use strict";
  var meta = document.querySelector(".entry-meta");
  if (!meta || document.querySelector("[data-reading-time]")) return;

  var article = document.querySelector(".md-typeset > :first-of-type") ||
                document.querySelector(".md-typeset");
  if (!article) return;

  var text = article.textContent || "";
  var words = text.trim().split(/\s+/).length;
  var minutes = Math.max(1, Math.round(words / 200));

  var el = document.createElement("span");
  el.className = "reading-time";
  el.setAttribute("data-reading-time", "");
  el.textContent = "~" + minutes + " min read";
  meta.appendChild(el);
})();
