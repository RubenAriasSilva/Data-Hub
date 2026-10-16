import { useState } from 'react';
import { Badge, CodeBlock, Alert } from '../../components/ui';
import { publicApiBase } from '../../api/client';
import { sampleValue } from '../../utils/format';

const METHOD_COLORS = { GET: 'blue', POST: 'green', DELETE: 'red' };

function Endpoint({ method, url, title, children }) {
  return (
    <div className="glass endpoint">
      <div className="endpoint-head">
        <Badge color={METHOD_COLORS[method]}>{method}</Badge>
        <span className="endpoint-url">{url}</span>
      </div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div className="muted small" style={{ marginBottom: 12 }}>{children[0]}</div>
      {children.slice(1)}
    </div>
  );
}

export default function ApiTab({ table }) {
  const [base] = useState(publicApiBase);
  const url = `${base}/api/v1/${table.category_slug}/${table.slug}`;
  const keys = table.columns.filter((c) => c.is_key);
  const sampleRow = (i) => Object.fromEntries(table.columns.map((c) => [c.db_name, sampleValue(c.data_type, i)]));
  const body = JSON.stringify({ rows: [sampleRow(0), sampleRow(1)] }, null, 2);
  const firstKey = keys[0];
  const keyQuery = keys.map((k) => `${k.db_name}=${encodeURIComponent(sampleValue(k.data_type))}`).join('&');

  return (
    <div className="stack">
      <Alert type="info">
        Las aplicaciones y RPAs se conectan por HTTP a estos endpoints (sin autenticación, solo red interna).
        Los campos pueden enviarse con el <strong>nombre en BD</strong> o con el <strong>nombre en Excel</strong>.
        Clave para upsert: {keys.map((k) => <span key={k.id} className="code-inline" style={{ marginLeft: 4 }}>{k.db_name}</span>)}
      </Alert>

      <p className="section-title" style={{ marginTop: 24 }}>Salida — leer datos</p>
      <div className="grid grid-2">
        <Endpoint method="GET" url={url} title="Consultar registros">
          <>Paginación con <span className="code-inline">page</span> y <span className="code-inline">limit</span> (máx. 5000), orden con <span className="code-inline">sort</span>/<span className="code-inline">order</span>, búsqueda <span className="code-inline">q</span>, filtro exacto por columna y <span className="code-inline">updated_since</span> para sincronización incremental.</>
          <CodeBlock>{`curl "${url}?limit=100&page=1${firstKey ? `&${firstKey.db_name}=${encodeURIComponent(sampleValue(firstKey.data_type))}` : ''}"

curl "${url}?updated_since=2024-05-15%2000:00:00"`}</CodeBlock>
        </Endpoint>
        <Endpoint method="GET" url={`${url}/schema`} title="Esquema de la tabla">
          Columnas, tipos, claves y endpoints disponibles.
          <CodeBlock>{`curl "${url}/schema"`}</CodeBlock>
        </Endpoint>
        <Endpoint method="GET" url={`${url}/export`} title="Exportar a Excel">
          Descarga todos los registros en .xlsx con los encabezados de Excel.
          <CodeBlock>{`curl -o ${table.slug}.xlsx "${url}/export"`}</CodeBlock>
        </Endpoint>
        <Endpoint method="GET" url={`${base}/api/v1`} title="Catálogo">
          Lista todas las tablas disponibles en el Data Hub con su URL.
          <CodeBlock>{`curl "${base}/api/v1"`}</CodeBlock>
        </Endpoint>
      </div>

      <p className="section-title" style={{ marginTop: 24 }}>Entrada — escribir datos</p>
      <div className="grid grid-2">
        <Endpoint method="POST" url={url} title="Upsert por JSON">
          <>Inserta filas nuevas y actualiza las existentes según la clave. Acepta un arreglo o <span className="code-inline">{'{ "rows": [...] }'}</span>. Las columnas no enviadas conservan su valor. Responde 200 (o 422 si ninguna fila fue válida) con el detalle por fila.</>
          <CodeBlock>{`curl -X POST "${url}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ rows: [sampleRow(0)] })}'`}</CodeBlock>
          <div style={{ marginTop: 10 }}><CodeBlock>{body}</CodeBlock></div>
        </Endpoint>
        <div className="stack">
          <Endpoint method="POST" url={`${url}/upload`} title="Subir Excel">
            <>Mismo proceso que la pestaña “Cargar Excel”. Campo multipart <span className="code-inline">file</span> (.xlsx / .xls).</>
            <CodeBlock>{`curl -X POST "${url}/upload" \\
  -F "file=@C:/ruta/archivo.xlsx"`}</CodeBlock>
          </Endpoint>
          <Endpoint method="DELETE" url={`${url}?${keys.map((k) => `${k.db_name}=…`).join('&')}`} title="Eliminar por clave">
            Indica el valor de todas las columnas clave.
            <CodeBlock>{`curl -X DELETE "${url}?${keyQuery}"`}</CodeBlock>
          </Endpoint>
        </div>
      </div>

      <p className="section-title" style={{ marginTop: 24 }}>Ejemplo Python (RPA)</p>
      <CodeBlock>{`import requests

URL = "${url}"

# Entrada: enviar transacciones
r = requests.post(URL, json={"rows": [${JSON.stringify(sampleRow(0))}]})
print(r.json())  # {"status": "success", "inserted": 1, "updated": 0, ...}

# Entrada: subir un Excel
with open("archivo.xlsx", "rb") as f:
    print(requests.post(URL + "/upload", files={"file": f}).json())

# Salida: leer registros
data = requests.get(URL, params={"limit": 500}).json()
for row in data["rows"]:
    print(row)`}</CodeBlock>
    </div>
  );
}
