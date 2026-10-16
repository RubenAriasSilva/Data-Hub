import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CategoryPage from './pages/CategoryPage';
import CreateTablePage from './pages/CreateTablePage';
import TableDetailPage from './pages/TableDetailPage';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="c/:categorySlug" element={<CategoryPage />} />
            <Route path="c/:categorySlug/new" element={<CreateTablePage />} />
            <Route path="c/:categorySlug/t/:tableSlug" element={<TableDetailPage />} />
            <Route path="*" element={<p className="muted">Página no encontrada.</p>} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
