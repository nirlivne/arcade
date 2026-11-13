// THE-1372: merges the active hero's copy (theme.js's heroes.bear / heroes.capy) over the shared keys,
// so every other module keeps reading theme.title / theme.text.* / theme.causeLines.* / theme.hints.* /
// theme.inRunLabels.* exactly as before -- only theme.js and this one small merge change per hero.
export function resolveActiveTheme(theme, heroKind) {
  const base = theme || {};
  const hero = (base.heroes && base.heroes[heroKind]) || {};
  return {
    ...base,
    // THE-1383: the resolved kind, not base.hero's raw setting -- a `?hero=` override must win here too
    // (ui/share-card.js picks its head drawing off this field).
    hero: heroKind,
    title: hero.name || base.title,
    tagline: hero.tagline ?? base.tagline,
    aboutText: hero.aboutText ?? base.aboutText,
    shareText: hero.shareText ?? base.shareText,
    aboutCredit: hero.aboutCredit || "",
    chaser: hero.chaser || "", // THE-1408: fills the one {chaser} mission text (missions.md)
    text: { ...base.text, ...hero.text },
    causeLines: { ...base.causeLines, ...hero.causeLines },
    hints: { ...base.hints, ...hero.hints },
    inRunLabels: { ...base.inRunLabels, ...hero.inRunLabels },
    deadpanLines: hero.deadpanLines || base.deadpanLines,
  };
}
