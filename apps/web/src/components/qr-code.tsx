import { encode } from "uqr";

/** QR code as an SVG built from React elements (no innerHTML). */
export function QrCode({
  value,
  label,
  size = 200,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const { data, size: modules } = encode(value, { ecc: "M", border: 2 });
  const cells: string[] = [];
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) {
        cells.push(`M${x} ${y}h1v1h-1z`);
      }
    });
  });
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      shapeRendering="crispEdges"
      className="rounded-md border border-neutral-300 bg-white"
    >
      <rect width={modules} height={modules} fill="#fff" />
      <path d={cells.join("")} fill="#000" />
    </svg>
  );
}
