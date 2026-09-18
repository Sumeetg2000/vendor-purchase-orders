import { useEffect, useState } from "react";
import { api } from "../services/api";
import { formatMoney } from "../utils/format";
import type { OutstandingOrdersResult, Vendor } from "../types";
import StatusTag from "../components/StatusTag";

const PAGE_SIZE = 20;

const EMPTY_RESULT: OutstandingOrdersResult = { items: [], total: 0, page: 1, pageSize: PAGE_SIZE };

export default function OutstandingOrdersPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [minAgeDays, setMinAgeDays] = useState("");
  const [maxAgeDays, setMaxAgeDays] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<OutstandingOrdersResult>(EMPTY_RESULT);
  const [error, setError] = useState<string | null>(null);

  async function refresh(targetPage: number) {
    setError(null);
    try {
      const filter: Parameters<typeof api.getOutstandingOrders>[0] = {
        page: targetPage,
        pageSize: PAGE_SIZE,
      };
      if (vendorId) filter.vendorId = vendorId;
      if (minAgeDays) filter.minAgeDays = Number(minAgeDays);
      if (maxAgeDays) filter.maxAgeDays = Number(maxAgeDays);
      setResult(await api.getOutstandingOrders(filter));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    }
  }

  useEffect(() => {
    api.listVendors().then(setVendors);
    refresh(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  function handleFilterSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    refresh(1);
  }

  function goToPage(nextPage: number) {
    setPage(nextPage);
    refresh(nextPage);
  }

  const hasPrev = result.page > 1;
  const hasNext = result.page * result.pageSize < result.total;

  return (
    <div>
      <h2>Outstanding Orders by Vendor and Age</h2>
      <form className="form-panel" onSubmit={handleFilterSubmit}>
        <div className="form-row">
          <div className="field">
            <label htmlFor="filter-vendor">Vendor</label>
            <select
              id="filter-vendor"
              value={vendorId}
              onChange={(event) => setVendorId(event.target.value)}
            >
              <option value="">All vendors</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-min-age">Min age (days)</label>
            <input
              id="filter-min-age"
              type="number"
              value={minAgeDays}
              onChange={(event) => setMinAgeDays(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="filter-max-age">Max age (days)</label>
            <input
              id="filter-max-age"
              type="number"
              value={maxAgeDays}
              onChange={(event) => setMaxAgeDays(event.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary">
            Filter
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>
      <p className="hint-text">
        <span className="num">{result.total}</span> outstanding order(s)
      </p>
      <table>
        <thead>
          <tr>
            <th>Order #</th>
            <th>Vendor</th>
            <th>Status</th>
            <th className="num">Total</th>
            <th className="num">Age (days)</th>
            <th>Outstanding lines</th>
          </tr>
        </thead>
        <tbody>
          {result.items.length === 0 && (
            <tr className="empty-row">
              <td colSpan={6}>No outstanding orders match this filter.</td>
            </tr>
          )}
          {result.items.map((item) => (
            <tr key={item.orderId}>
              <td className="mono">{item.orderNumber}</td>
              <td>{item.vendorName}</td>
              <td>
                <StatusTag status={item.status} />
              </td>
              <td className="num">{formatMoney(item.total)}</td>
              <td className="num">{item.ageDays}</td>
              <td>
                {item.outstandingLines
                  .map((line) => `${line.description} (${line.outstandingQty} left)`)
                  .join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.total > result.pageSize && (
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            disabled={!hasPrev}
            onClick={() => goToPage(page - 1)}
          >
            Previous
          </button>
          <span className="hint-text">Page {result.page}</span>
          <button
            type="button"
            className="btn"
            disabled={!hasNext}
            onClick={() => goToPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
