import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Enlaces externos en pestaña nueva; los anclajes (#seccion) se quedan en la página
const components = {
  a: ({ node, href, ...props }) => (
    <a href={href} {...props} {...(href?.startsWith('#') ? {} : { target: '_blank', rel: 'noreferrer' })} />
  ),
};

/**
 * Markdown con extensiones de GitHub (tablas, listas de tareas, tachado, autolinks).
 * react-markdown no interpreta HTML crudo, así que el contenido subido no puede inyectar scripts.
 */
export default function Markdown({ children }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
    </div>
  );
}
