import { useState } from 'react';
import { CodeBlock, Alert } from '../../../components/ui';
import { publicApiBase } from '../../../api/client';
import { apiPath } from '../../../utils/format';
import { Endpoint } from '../ApiTab';

const OS = ['Windows', 'Linux', 'Python'];

export default function MongoApiTab({ table }) {
  const [base] = useState(publicApiBase);
  const [os, setOs] = useState('Windows');
  const url = `${base}${apiPath(table)}`;
  const keys = table.key_fields;
  const key = keys.find((k) => k !== '_id') ?? 'codigo';

  const doc = { [key]: 1001, nombre: 'ejemplo', cliente: { nombre: 'Ana', ciudad: 'Guadalajara' }, etiquetas: ['web'], fecha: { $date: '2024-05-15T08:30:00Z' } };
  const jsonBody = JSON.stringify({ documents: [doc] }, null, 2);
  const filter = JSON.stringify({ [key]: 1001 });
  const queryBody = JSON.stringify({ filter: { 'cliente.ciudad': 'Guadalajara' }, projection: { nombre: 1, cliente: 1 }, sort: { _updated_at: -1 }, limit: 100 }, null, 2);

  const examples = {
    upload: {
      Linux: `curl -X POST "${url}/upload" \\\n  -F "file=@/ruta/coleccion.bson"`,
      Windows: `curl.exe -X POST "${url}/upload" -F "file=@C:/ruta/datos.json"`,
      Python: `import requests

with open("datos.ndjson", "rb") as f:
    r = requests.post("${url}/upload", files={"file": f})
print(r.json())  # {"status": "success", "inserted": 1, "updated": 0, ...}`,
    },
    write: {
      Linux: `curl -X POST "${url}" \\\n  -H "Content-Type: application/json" \\\n  -d @documentos.json`,
      Windows: `curl.exe -X POST "${url}" -H "Content-Type: application/json" -d "@C:/ruta/documentos.json"`,
      Python: `import requests

docs = ${JSON.stringify([doc])}
r = requests.post("${url}", json={"documents": docs})
print(r.json())`,
    },
    query: {
      Linux: `curl -X POST "${url}/query" \\\n  -H "Content-Type: application/json" \\\n  -d @consulta.json`,
      Windows: `curl.exe -X POST "${url}/query" -H "Content-Type: application/json" -d "@C:/ruta/consulta.json"`,
      Python: `import requests

r = requests.post("${url}/query", json=${queryBody.replace(/\n\s*/g, ' ')})
for doc in r.json()["documents"]:
    print(doc)`,
    },
  };
  const osTabs = (
    <div className="tabs" style={{ marginBottom: 10 }}>
      {OS.map((o) => <button key={o} type="button" className={`tab${os === o ? ' active' : ''}`} onClick={() => setOs(o)}>{o}</button>)}
    </div>
  );

  return (
    <div className="stack">
      <Alert type="info">
        Colección MongoDB: su API vive en <span className="code-inline">/api/mongo/v1</span> (distinta de las tablas MySQL). Endpoints HTTP sin autenticación (solo red interna).
        {' '}{keys.length
          ? <>Clave para upsert: {keys.map((k) => <span key={k} className="code-inline" style={{ marginLeft: 4 }}>{k}</span>)}</>
          : 'Sin campos clave: cada envío inserta documentos nuevos.'}
      </Alert>

      <div className="grid grid-2" style={{ marginTop: 24, alignItems: 'start' }}>
        <div className="stack">
          <Endpoint method="POST" url={url} title="Entrada — Documentos JSON">
            <>Un documento, un arreglo <span className="code-inline">[ {'{…}'} ]</span> o <span className="code-inline">{'{ "documents": [ … ] }'}</span>. Acepta objetos anidados, arreglos y tipos extendidos (<span className="code-inline">$date</span>, <span className="code-inline">$oid</span>).</>
            <CodeBlock>{jsonBody}</CodeBlock>
            <div style={{ marginTop: 10 }}>{osTabs}</div>
            <CodeBlock>{examples.write[os]}</CodeBlock>
          </Endpoint>
          <Endpoint method="POST" url={`${url}/upload`} title="Entrada — Subir archivo (JSON, NDJSON, BSON, Excel o CSV)">
            <>Mismo proceso que la pestaña “Cargar datos”. Campo multipart <span className="code-inline">file</span>: <span className="code-inline">.json</span>, <span className="code-inline">.ndjson</span>/<span className="code-inline">.jsonl</span>, <span className="code-inline">.bson</span> (mongodump), <span className="code-inline">.xlsx</span>/<span className="code-inline">.xls</span>/<span className="code-inline">.csv</span> (encabezados con punto se anidan).</>
            {osTabs}
            <CodeBlock>{examples.upload[os]}</CodeBlock>
          </Endpoint>
          <Endpoint method="PUT" url={`${url}/docs/{_id}`} title="Reemplazar un documento">
            <>Reemplaza el documento completo con el cuerpo JSON; conserva <span className="code-inline">_id</span> y <span className="code-inline">_created_at</span>. También <span className="code-inline">GET</span> (leer) y <span className="code-inline">DELETE</span> (eliminar) en la misma URL.</>
            <CodeBlock>{`${url}/docs/65a1b2c3d4e5f6a7b8c9d0e1`}</CodeBlock>
          </Endpoint>
        </div>
        <div className="stack">
          <Endpoint method="GET" url={url} title="Salida — JSON paginado con filtro">
            <>Parámetros: <span className="code-inline">filter</span> (JSON de MongoDB), <span className="code-inline">fields</span> (lista separada por comas), <span className="code-inline">sort</span>, <span className="code-inline">order</span>, <span className="code-inline">page</span>, <span className="code-inline">limit</span> (máx. 5000), <span className="code-inline">updated_since</span>, <span className="code-inline">q</span> (texto).</>
            <CodeBlock>{`${url}?filter=${encodeURIComponent(filter)}&fields=${key},cliente.nombre&limit=100`}</CodeBlock>
          </Endpoint>
          <Endpoint method="POST" url={`${url}/query`} title="Salida — Consulta libre">
            <>Para filtros largos: <span className="code-inline">filter</span>, <span className="code-inline">projection</span>, <span className="code-inline">sort</span>, <span className="code-inline">skip</span> y <span className="code-inline">limit</span> en el cuerpo. No se permiten <span className="code-inline">$where</span> ni <span className="code-inline">$function</span>.</>
            <CodeBlock>{queryBody}</CodeBlock>
            <div style={{ marginTop: 10 }}>{osTabs}</div>
            <CodeBlock>{examples.query[os]}</CodeBlock>
          </Endpoint>
          <Endpoint method="GET" url={`${url}?format=csv`} title="Salida — CSV aplanado (descarga / Power BI)">
            <>Todos los documentos (o los del <span className="code-inline">filter</span>) con una columna por campo: los anidados como <span className="code-inline">cliente.nombre</span> y los arreglos como JSON. En Power BI: <strong>Obtener datos → Web</strong>.</>
            <CodeBlock>{`${url}?format=csv`}</CodeBlock>
          </Endpoint>
        </div>
      </div>
    </div>
  );
}
