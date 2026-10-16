# Design System — ZF ESL Digitalization
> Basado en `02_Links80` · Implementado en `09_MRO` · Aplicar en apps nuevas

---

## 1. Concepto visual

| Elemento | Descripción |
|----------|-------------|
| **Fondo** | Degradado radial azul suave fijo (`background-attachment: fixed`) |
| **Superficies** | Glassmorphism — blanco semitransparente con blur 24-28px |
| **Color dominante** | Azul slate `#2563eb` / `#1d4ed8` |
| **Texto** | Paleta slate de Tailwind (sin negro puro) |
| **Bordes** | Sutiles, siempre `rgba(0,0,0,0.07)` o `rgba(255,255,255,0.88)` |
| **Font** | `Inter, -apple-system, BlinkMacSystemFont` |

---

## 2. CSS Variables — copiar completo en `index.css`

```css
:root {
  --body-bg:
    radial-gradient(ellipse at 20% 8%,  rgba(147,197,253,.40) 0%, transparent 52%),
    radial-gradient(ellipse at 85% 90%, rgba(196,181,253,.25) 0%, transparent 50%),
    radial-gradient(ellipse at 50% 50%, rgba(219,234,254,.18) 0%, transparent 70%),
    linear-gradient(168deg, #eef5ff 0%, #e8f1fe 35%, #eef2ff 65%, #f3f0ff 100%);

  --nav-bg:        rgba(255,255,255,.78);
  --nav-border:    rgba(0,0,0,.07);
  --sb-bg:         rgba(255,255,255,.60);
  --sb-border:     rgba(0,0,0,.07);

  --glass:         rgba(255,255,255,.68);
  --glass-hover:   rgba(255,255,255,.84);
  --glass-border:  rgba(255,255,255,.88);
  --glass-inner:   rgba(255,255,255,.55);
  --glass-shadow:  0 8px 32px rgba(80,110,180,.10);
  --glass-shadow-hover: 0 20px 48px rgba(80,110,180,.16);

  /* Texto — escala slate */
  --txt1: rgba(15,23,42,.92);    /* títulos, valores */
  --txt2: rgba(51,65,85,.75);    /* texto normal */
  --txt3: rgba(100,116,139,.68); /* secundario, labels */
  --txt4: rgba(148,163,184,.70); /* placeholder, muted */

  /* Sidebar/Nav */
  --nav-active-bg:   rgba(59,130,246,.10);
  --nav-hover-bg:    rgba(0,0,0,.04);
  --nav-active-icon: #2563eb;
  --nav-active-txt:  rgba(30,64,175,.95);
  --nav-icon:        rgba(71,85,105,.52);
  --nav-txt:         rgba(51,65,85,.70);

  /* Accent */
  --accent:        #2563eb;
  --accent-hover:  #1d4ed8;
  --accent-subtle: rgba(59,130,246,.10);

  /* Modales y formularios */
  --modal-overlay: rgba(100,120,180,.32);
  --modal-bg:      rgba(240,246,255,.96);
  --form-input-bg: rgba(0,0,0,.04);
  --form-input-border: rgba(0,0,0,.12);
  --form-label:    rgba(51,65,85,.72);
  --divider:       rgba(0,0,0,.07);
  --scrollbar:     rgba(0,0,0,.10);
}
```

---

## 3. Tokens de color (inline styles en JSX)

| Uso | Valor |
|-----|-------|
| Texto primario | `rgba(15,23,42,0.92)` |
| Texto secundario | `rgba(51,65,85,0.75)` |
| Texto terciario / labels | `rgba(100,116,139,0.68)` |
| Texto muted / placeholder | `rgba(148,163,184,0.70)` |
| Accent azul | `#2563eb` |
| Accent oscuro hover | `#1d4ed8` |
| Error / crítico | `#b91c1c` |
| Warning / urgente | `#b45309` |
| Success / ok | `#166534` |
| Borde claro | `rgba(0,0,0,0.07)` |
| Fondo card hover | `rgba(59,130,246,0.04)` |

---

## 4. Base — `body` + `#root`

```css
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  background: var(--body-bg);
  background-attachment: fixed;
  color: var(--txt1);
  -webkit-font-smoothing: antialiased;
}
```

---

## 5. Glass

### `.glass` — cards, panels, tablas
```css
.glass {
  background: var(--glass);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow), inset 0 1px 0 var(--glass-inner);
  border-radius: 16px;
}
.glass:hover {  /* opcional en cards clickeables */
  background: var(--glass-hover);
  box-shadow: var(--glass-shadow-hover), inset 0 1px 0 var(--glass-inner);
  transform: translateY(-1px);
}
```

### `.glass-strong` — modales, login card
```css
.glass-strong {
  background: var(--modal-bg);           /* rgba(240,246,255,.96) */
  backdrop-filter: blur(32px) saturate(200%);
  -webkit-backdrop-filter: blur(32px) saturate(200%);
  border: 1px solid rgba(0,0,0,.09);
  border-radius: 20px;
  box-shadow: 0 24px 64px rgba(80,110,180,.16), 0 0 0 0.5px rgba(0,0,0,.05);
}
```

### Sidebar / Topbar (inline en JSX)
```jsx
/* Sidebar */
background: 'rgba(255,255,255,0.62)',
backdropFilter: 'saturate(180%) blur(28px)',
borderRight: '1px solid rgba(0,0,0,0.07)',

/* Topbar */
background: 'rgba(255,255,255,0.78)',
backdropFilter: 'saturate(180%) blur(28px)',
borderBottom: '1px solid rgba(0,0,0,0.07)',
```

---

## 6. Tipografía

```css
.page-title    { font-size: 1.4rem;  font-weight: 700; color: var(--txt1); letter-spacing: -.02em; }
.page-subtitle { font-size: .875rem; color: var(--txt3); }
.section-title { font-size: .72rem;  font-weight: 700; color: var(--txt3);
                 text-transform: uppercase; letter-spacing: .08em; }
.metric-value  { font-size: 1.75rem; font-weight: 700; color: var(--txt1); letter-spacing: -.02em; }
.metric-label  { font-size: .72rem;  font-weight: 600; color: var(--txt3);
                 text-transform: uppercase; letter-spacing: .06em; }
```

---

## 7. Botones

```css
/* Primario — fondo azul sólido */
.btn-primary {
  background: var(--accent); color: #fff;
  border: none; border-radius: 10px;
  padding: 8px 18px; font-size: .875rem; font-weight: 600;
  cursor: pointer; transition: all .2s;
  display: inline-flex; align-items: center; gap: 6px;
}
.btn-primary:hover { background: var(--accent-hover); box-shadow: 0 4px 14px rgba(37,99,235,.35); }

/* Secundario — glass */
.btn-secondary {
  background: var(--glass); color: var(--txt2);
  border: 1px solid var(--glass-border); border-radius: 10px;
  padding: 8px 18px; font-size: .875rem; font-weight: 600;
}
.btn-secondary:hover { background: var(--glass-hover); color: var(--txt1); }

/* Ghost — solo texto */
.btn-ghost {
  background: transparent; color: var(--txt3);
  border: none; border-radius: 8px; padding: 6px 10px;
}
.btn-ghost:hover { background: var(--nav-hover-bg); color: var(--txt1); }

/* Danger */
.btn-danger {
  background: rgba(220,38,38,.10); color: #b91c1c;
  border: 1px solid rgba(220,38,38,.20); border-radius: 10px;
  padding: 8px 18px;
}

/* Tamaños */
.btn-sm { padding: 5px 12px !important; font-size: .8rem !important; }
.btn-lg { padding: 11px 24px !important; font-size: 1rem !important; font-weight: 700 !important; }
```

---

## 8. Inputs y formularios

```css
input, select, textarea {
  background: var(--form-input-bg) !important;    /* rgba(0,0,0,.04) */
  border: 1px solid var(--form-input-border) !important; /* rgba(0,0,0,.12) */
  border-radius: 10px !important;
  color: var(--txt1) !important;
  padding: 9px 12px; font-size: .875rem;
  outline: none; transition: all .2s;
}
input:focus, select:focus {
  border-color: rgba(37,99,235,.55) !important;
  box-shadow: 0 0 0 3px rgba(59,130,246,.14) !important;
  background: rgba(255,255,255,.85) !important;
}
.form-label {
  font-size: .72rem; font-weight: 700; color: var(--form-label);
  text-transform: uppercase; letter-spacing: .05em;
}
```

---

## 9. Tabla

```css
thead th {
  background: rgba(0,0,0,.025);
  color: var(--txt3);
  font-size: .69rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: .06em;
  padding: 10px 16px;
  border-bottom: 1px solid var(--divider);
}
tbody tr { border-bottom: 1px solid var(--divider); }
tbody tr:hover { background: rgba(59,130,246,.04); }
tbody td { padding: 13px 16px; font-size: .875rem; color: var(--txt1); }
```

---

## 10. Badges / Pills

```css
.badge {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 999px;
  font-size: .69rem; font-weight: 600; letter-spacing: .03em;
}

/* Colores semánticos */
.badge-blue   { background: rgba(37,99,235,.10);  color: #1d4ed8; }  /* info, normal */
.badge-green  { background: rgba(21,128,61,.10);  color: #166534; }  /* ok, recibido */
.badge-orange { background: rgba(180,83,9,.10);   color: #b45309; }  /* warning, pendiente */
.badge-red    { background: rgba(220,38,38,.10);  color: #b91c1c; }  /* error, crítico */
.badge-gray   { background: rgba(100,116,139,.10); color: rgba(100,116,139,.80); } /* inactivo */
```

**Regla de asignación:**
| Estado | Color |
|--------|-------|
| Activo, confirmado, aprobado, recibido | 🔵 Azul |
| Completado, entrada, fulfillled | 🟢 Verde |
| Pendiente, urgente, warning | 🟠 Naranja |
| Crítico, error, salida, corrective | 🔴 Rojo |
| Inactivo, cancelado, draft | ⚫ Gris |

---

## 11. Sidebar item

```css
.sidebar-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 10px;
  color: var(--nav-txt); font-size: .875rem; font-weight: 500;
  text-decoration: none; transition: background .15s;
}
.sidebar-item:hover  { background: var(--nav-hover-bg); color: var(--txt1); }
.sidebar-item.active { background: var(--nav-active-bg); color: var(--nav-active-txt); font-weight: 600; }
.sidebar-item.active svg { color: var(--nav-active-icon); }  /* #2563eb */
```

---

## 12. Modal overlay

```css
.modal-overlay {
  position: fixed; inset: 0; z-index: 50;
  display: flex; align-items: center; justify-content: center; padding: 16px;
  background: var(--modal-overlay);  /* rgba(100,120,180,.32) */
  backdrop-filter: blur(10px);
}
```

---

## 13. Charts (Recharts)

```jsx
// Paleta de azules para series
const COLORS = ['#2563eb','#3b82f6','#60a5fa','#93c5fd','#1d4ed8','#1e40af'];

// Tooltip con glass claro
const Tooltip = ({ active, payload, label }) => active && payload?.length ? (
  <div style={{
    background: 'rgba(240,246,255,0.96)',
    border: '1px solid rgba(0,0,0,0.10)',
    borderRadius: 10, padding: '10px 14px',
    boxShadow: '0 4px 16px rgba(80,110,180,0.12)'
  }}>
    {label && <p style={{ fontSize: '.75rem', color: 'rgba(100,116,139,.68)', marginBottom: 6 }}>{label}</p>}
    {payload.map((p, i) => (
      <p key={i} style={{ fontSize: '.82rem', color: p.color, fontWeight: 500 }}>
        {p.name}: {p.value}
      </p>
    ))}
  </div>
) : null;

// Grid y ejes
<CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
<XAxis tick={{ fill: 'rgba(100,116,139,0.80)', fontSize: 11 }} axisLine={false} tickLine={false} />
<YAxis tick={{ fill: 'rgba(100,116,139,0.80)', fontSize: 11 }} axisLine={false} tickLine={false} />

// Gradiente para AreaChart
<defs>
  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="5%"  stopColor="#2563eb" stopOpacity={0.22}/>
    <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
  </linearGradient>
</defs>
<Area dataKey="valor" stroke="#2563eb" strokeWidth={2} fill="url(#grad)" />
```

---

## 14. Animaciones

```css
@keyframes fadeIn  { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
@keyframes slideIn { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }
@keyframes spin    { to { transform:rotate(360deg); } }

.animate-in { animation: fadeIn  .25s ease forwards; }
.slide-in   { animation: slideIn .20s ease forwards; }
```

---

## 15. Scrollbar

```css
::-webkit-scrollbar       { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 4px; }
```

---

## 16. Logo ZF

El SVG original está en `C:\Development\35_Almacen\frontend\public\ZF_logo_STD_Blue_3CC.svg`  
Cópialo como `public/ZF_logo.svg` en cada proyecto y úsalo así:

```jsx
/* Sidebar colapsado: solo logo */
<img src="/ZF_logo.svg" alt="ZF" style={{ width: 34, height: 34 }} />

/* Login: logo grande centrado */
<img src="/ZF_logo.svg" alt="ZF" style={{ width: 56, height: 56, margin: '0 auto 16px', display: 'block' }} />
```

---

## 17. Checklist para nueva app

- [ ] Copiar las **CSS variables** (sección 2) a `index.css`
- [ ] Agregar `body { background: var(--body-bg); background-attachment: fixed; }`
- [ ] Copiar clases: `.glass`, `.glass-strong`, `.badge`, `.btn-*`, `table`, inputs
- [ ] Copiar `ZF_logo.svg` a `public/`
- [ ] Sidebar: `background rgba(255,255,255,0.62)`, `blur(28px)` + logo ZF
- [ ] Topbar: `background rgba(255,255,255,0.78)`, `blur(28px)`
- [ ] Charts: paleta de azules, tooltip con `rgba(240,246,255,0.96)`
- [ ] Textos hardcoded: usar tokens de sección 3, **nunca negro puro**
- [ ] Badges: asignar colores según tabla semántica (sección 10)
