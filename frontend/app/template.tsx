// template.tsx remounts on every navigation, so the page-in animation replays like the mockup's go()
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <main id="view" className="anim-page max-w-6xl mx-auto px-4 py-6">
      {children}
    </main>
  );
}
