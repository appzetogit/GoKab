import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';

// The biggest table on the page (the main list), ignoring tiny layout tables.
const findMainTable = () => {
  const tables = Array.from(document.querySelectorAll('main table'));
  const withRows = tables.filter((t) => t.querySelectorAll('tbody tr').length > 0 && t.querySelectorAll('th').length > 1);
  if (!withRows.length) return null;
  return withRows.sort((a, b) => b.querySelectorAll('tr').length - a.querySelectorAll('tr').length)[0];
};

const cell = (node) => `"${String(node.innerText || '').replace(/\s+/g, ' ').trim().replace(/"/g, '""')}"`;

/**
 * Shows an "Export" button in the header on any page that has a list table and saves what is
 * on screen as a CSV file (opens in Excel). It only reads the page: nothing is changed.
 */
const TableExportButton = () => {
  const location = useLocation();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    setAvailable(false);
    const check = () => setAvailable(Boolean(findMainTable()));
    const first = setTimeout(check, 1200);
    const timer = setInterval(check, 2500);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [location.pathname]);

  if (!available) return null;

  const exportCsv = () => {
    const table = findMainTable();
    if (!table) return toast.error('No table to export on this page');
    const header = Array.from(table.querySelectorAll('thead th')).map(cell);
    const rows = Array.from(table.querySelectorAll('tbody tr'))
      .map((tr) => Array.from(tr.children).map(cell))
      // skip "no data" rows that span the whole table
      .filter((cols) => cols.length > 1);
    if (!rows.length) return toast.error('The table is empty');
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const name = (location.pathname.split('/').filter(Boolean).pop() || 'list').replace(/[^a-z0-9-]/gi, '');
    link.href = url;
    link.download = `gokab-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success(`Saved ${rows.length} rows`);
  };

  return (
    <button
      type="button"
      onClick={exportCsv}
      title="Save the list on this page as an Excel (CSV) file"
      className="hidden sm:flex items-center gap-2 rounded-xl h-10 px-3 border border-slate-200 bg-white text-slate-600 text-[13px] font-bold hover:border-indigo-300 hover:text-slate-900 transition-all"
    >
      <Download size={16} />
      <span className="hidden lg:inline">Export list</span>
    </button>
  );
};

export default TableExportButton;
