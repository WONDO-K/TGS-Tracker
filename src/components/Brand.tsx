import { Link } from "react-router-dom";
export function Brand() {
  return (
    <Link className="brand" to="/board">
      <svg width="34" height="34" viewBox="0 0 40 40" aria-hidden="true">
        <rect width="40" height="40" rx="11" fill="currentColor" />
        <rect x="8" y="9" width="5.5" height="6" rx="2" fill="#7A8599" />
        <rect x="14.2" y="9" width="5.5" height="6" rx="2" fill="#4A70EA" />
        <rect x="20.3" y="9" width="5.5" height="6" rx="2" fill="#E0A02A" />
        <rect x="26.5" y="9" width="5.5" height="6" rx="2" fill="#3BA788" />
        <rect x="17.5" y="17" width="5" height="10" rx="2.5" fill="#fff" />
        <circle cx="20" cy="31.5" r="2.7" fill="#fff" />
      </svg>
      <span>
        <strong>TGS</strong> <span>Tracker</span>
      </span>
    </Link>
  );
}
