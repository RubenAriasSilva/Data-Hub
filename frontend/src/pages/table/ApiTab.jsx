import { useState } from 'react';
import { Badge, CodeBlock, Alert } from '../../components/ui';
import { publicApiBase } from '../../api/client';
import { apiPath, sampleValue } from '../../utils/format';

const METHOD_COLORS = { GET: 'blue', POST: 'green', PUT: 'orange', DELETE: 'red' };

export function Endpoint({ method, url, title, children }) {
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
  const url = `${base}${apiPath(table)}`;
  const keys = table.columns.filter((c) => c.is_key);
  const [uploadOs, setUploadOs] = useState('Windows');
  const uploadExamples = {
    Linux: `curl -X POST "${url}/upload" \\
  -F "file=@/ruta/archivo.xlsx"`,
    // curl.exe (no el alias "curl" de PowerShell) funciona igual en cmd y en PowerShell
    Windows: `curl.exe -X POST "${url}/upload" -F "file=@C:/ruta/archivo.xlsx"`,
    Python: `import requests

with open("archivo.xlsx", "rb") as f:
    r = requests.post("${url}/upload", files={"file": f})
print(r.json())  # {"status": "success", "inserted": 1, "updated": 0, ...}`,
  };
  // Cuerpo de ejemplo con los nombres en BD (no cambian si se renombra el encabezado del Excel)
  const sampleRow = Object.fromEntries(table.columns.map((c) => [c.db_name, sampleValue(c.data_type)]));
  const jsonBody = JSON.stringify({ rows: [sampleRow] }, null, 2);
  const jsonExamples = {
    Linux: `curl -X POST "${url}" \\
  -H "Content-Type: application/json" \\
  -d @datos.json`,
    // Con el cuerpo en un archivo se evitan los problemas de comillas de cmd/PowerShell
    Windows: `curl.exe -X POST "${url}" -H "Content-Type: application/json" -d "@C:/ruta/datos.json"`,
    Python: `import requests

filas = ${JSON.stringify([sampleRow])}
r = requests.post("${url}", json={"rows": filas})
print(r.json())`,
  };
  const osTabs = (
    <div className="tabs" style={{ marginBottom: 10 }}>
      {Object.keys(uploadExamples).map((os) => (
        <button key={os} type="button" className={`tab${uploadOs === os ? ' active' : ''}`} onClick={() => setUploadOs(os)}>{os}</button>
      ))}
    </div>
  );

  return (
    <div className="stack">
      <Alert type="info">
        Endpoints HTTP sin autenticación (solo red interna).
        Clave para upsert: {keys.map((k) => <span key={k.id} className="code-inline" style={{ marginLeft: 4 }}>{k.db_name}</span>)}
      </Alert>

      <div className="grid grid-2" style={{ marginTop: 24, alignItems: 'start' }}>
        <div className="stack">
          <Endpoint method="POST" url={`${url}/upload`} title="Entrada — Subir archivo (Excel, CSV o JSON)">
            <>Mismo proceso que la pestaña “Cargar datos”: inserta filas nuevas y actualiza las existentes según la clave. Campo multipart <span className="code-inline">file</span> (.xlsx / .xls / .csv / .json). En CSV el separador (<span className="code-inline">,</span> o <span className="code-inline">;</span>) se detecta solo.</>
            {osTabs}
            <CodeBlock>{uploadExamples[uploadOs]}</CodeBlock>
          </Endpoint>
          <Endpoint method="POST" url={url} title="Entrada — JSON">
            <>Envía las filas en el cuerpo: un arreglo <span className="code-inline">[ {'{…}'} ]</span> o <span className="code-inline">{'{ "rows": [ … ] }'}</span>. Cada campo puede usar el nombre en BD o en Excel; los que no existen se ignoran.</>
            <CodeBlock>{jsonBody}</CodeBlock>
            <div style={{ marginTop: 10 }}>{osTabs}</div>
            <CodeBlock>{jsonExamples[uploadOs]}</CodeBlock>
          </Endpoint>
        </div>
        <div className="stack">
          <Endpoint method="GET" url={`${url}?format=json`} title="Salida — JSON (apps / RPAs)">
            <>Filas en JSON, paginadas y filtrables. También responde JSON si la petición envía <span className="code-inline">Accept: application/json</span>.</>
            <CodeBlock>{`${url}?format=json&page=1&limit=5000`}</CodeBlock>
          </Endpoint>
          <Endpoint method="GET" url={url} title="Salida — CSV (descarga / Power BI)">
            <>Sirve para <strong>descargar el CSV</strong> con todas las filas (sin paginación) y los nombres de columna originales del Excel. En Power BI: <strong>Obtener datos → Web</strong>, pega la URL y pulsa <strong>Cargar</strong>.</>
            <CodeBlock>{url}</CodeBlock>
          </Endpoint>
        </div>
      </div>
    </div>
  );
}
