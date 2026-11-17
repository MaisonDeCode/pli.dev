import { PRODUCTS, type Demo } from "./demos";
import { Preview } from "./Preview";
import { openDemo, routePath } from "./router";

/** The front door: every screen the playground has, grouped by editor, and the editors still to come. */
export function Landing() {
  const ready = PRODUCTS.filter((product) => product.demos.length > 0);
  const coming = PRODUCTS.filter((product) => product.demos.length === 0);
  return (
    <main className="landing">
      <header className="landing-head">
        <h1>Pli playground</h1>
        <p>
          Pli is an open-source toolkit for building editors. These are the real components running with no
          mock-ups: pick a screen and try it.
        </p>
      </header>

      {ready.map((product) => (
        <section key={product.name} className="landing-product" aria-labelledby={`p-${product.name}`}>
          <h2 id={`p-${product.name}`}>{product.name}</h2>
          <p className="landing-blurb">{product.blurb}</p>
          <ul className="landing-cards">
            {product.demos.map((demo) => (
              <li key={demo.id}>
                <DemoCard demo={demo} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {coming.length > 0 && (
        <section className="landing-product" aria-labelledby="p-coming">
          <h2 id="p-coming">Coming next</h2>
          <ul className="landing-soon">
            {coming.map((product) => (
              <li key={product.name}>
                <strong>{product.name}</strong>
                <span>{product.blurb}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function DemoCard({ demo }: { demo: Demo }) {
  return (
    <div className="landing-card">
      <Preview id={demo.id} />
      <div className="landing-text">
        <h3>
          <a
            href={routePath(demo.id)}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              openDemo(demo.id);
            }}
          >
            {demo.title}
          </a>
        </h3>
        <p>{demo.summary}</p>
      </div>
    </div>
  );
}
