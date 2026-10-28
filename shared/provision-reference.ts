export function parseProvisionReference(reference: string, scope = "") {
  scope = scope.trim();
  const match = /^(\d+\.\d+\.\d+\.\d+)\.?(?:\(([1-9]\d*)\)(?:\(([a-z])\)(?:\(([ivxlcdm]+)\))?)?)?$/.exec(reference);
  if (!match) throw new Error("Use an exact article, sentence, clause or subclause identifier, such as 3.8.3.5.(1)(b).");
  const article = match[1];
  return { article, reference: `${article}.${match[2] ? `(${match[2]})` : ""}${match[3] ? `(${match[3]})` : ""}${match[4] ? `(${match[4]})` : ""}`,
    level: scope ? "text_span" : match[4] ? "subclause" : match[3] ? "clause" : match[2] ? "sentence" : "article", scope: scope.trim() };
}
