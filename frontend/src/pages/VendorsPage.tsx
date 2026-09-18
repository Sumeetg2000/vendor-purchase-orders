import { useEffect, useState } from "react";
import { api } from "../services/api";
import type { Vendor } from "../types";
import ConfirmModal from "../components/ConfirmModal";

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [name, setName] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("Net 30");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deactivatingVendor, setDeactivatingVendor] = useState<Vendor | null>(null);

  async function refresh() {
    setVendors(await api.listVendors());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await api.createVendor({ name, paymentTerms });
      setName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h2>Vendors</h2>
      <form className="form-panel" onSubmit={handleCreate}>
        <div className="form-row">
          <div className="field">
            <label htmlFor="vendor-name">Vendor name</label>
            <input
              id="vendor-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="vendor-terms">Payment terms</label>
            <input
              id="vendor-terms"
              value={paymentTerms}
              onChange={(event) => setPaymentTerms(event.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn-primary" disabled={creating}>
            Add vendor
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Payment Terms</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {vendors.length === 0 && (
            <tr className="empty-row">
              <td colSpan={4}>No vendors yet.</td>
            </tr>
          )}
          {vendors.map((vendor) => (
            <tr key={vendor.id}>
              <td>{vendor.name}</td>
              <td>{vendor.paymentTerms}</td>
              <td>
                <span
                  className={`status-tag ${vendor.isActive ? "status-approved" : "status-cancelled"}`}
                >
                  {vendor.isActive ? "Active" : "Inactive"}
                </span>
              </td>
              <td className="table-actions">
                {vendor.isActive && (
                  <button className="btn" onClick={() => setDeactivatingVendor(vendor)}>
                    Deactivate
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {deactivatingVendor && (
        <ConfirmModal
          title="Deactivate vendor"
          message={`Deactivate "${deactivatingVendor.name}"? This vendor will no longer be selectable for new purchase orders.`}
          confirmLabel="Deactivate"
          onClose={() => setDeactivatingVendor(null)}
          onConfirm={async () => {
            await api.deactivateVendor(deactivatingVendor.id);
            setDeactivatingVendor(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
