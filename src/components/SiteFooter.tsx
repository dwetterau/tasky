export function SiteFooter() {
  return (
    <footer className="border-t border-(--card-border) bg-background/80 px-4 py-2 text-right text-xs text-(--muted)/70">
      made by{" "}
      <a
        href="https://github.com/dwetterau"
        target="_blank"
        rel="noreferrer"
        className="text-(--muted)/85 transition-colors hover:text-accent"
      >
        @dwetterau
      </a>{" "}
      ·{" "}
      <a
        href="https://github.com/dwetterau/tasky/issues"
        target="_blank"
        rel="noreferrer"
        className="text-(--muted)/85 transition-colors hover:text-accent"
      >
        File issue
      </a>
    </footer>
  );
}
