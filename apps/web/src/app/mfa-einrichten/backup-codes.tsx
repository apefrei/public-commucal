"use client";

/** Shows the backup codes once, offers a text download and asks for confirmation that they are saved (FR-4). */
export function BackupCodes({
  codes,
  saved,
  onSavedChange,
}: {
  codes: string[];
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
}) {
  function download() {
    const text = [
      "CommuCal – Backup-Codes",
      "Jeder Code funktioniert nur einmal. Bewahren Sie diese Datei sicher auf.",
      "",
      ...codes,
      "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "commucal-backup-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-1">
      <p className="mb-3 text-neutral-700">
        Mit einem Backup-Code melden Sie sich an, wenn Sie Ihr Gerät nicht zur Hand haben. Die Codes
        werden nur jetzt angezeigt.
      </p>
      <ul className="grid grid-cols-2 gap-1 rounded-md border border-neutral-300 bg-neutral-50 p-3 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={download}
        className="mt-3 rounded-md border border-neutral-400 px-3 py-1.5 text-sm hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
      >
        Als Textdatei herunterladen
      </button>
      <div className="mt-3 flex items-start gap-2">
        <input
          id="codes-saved"
          type="checkbox"
          checked={saved}
          onChange={(event) => onSavedChange(event.target.checked)}
          className="mt-1 h-4 w-4"
        />
        <label htmlFor="codes-saved" className="text-sm">
          Ich habe die Backup-Codes sicher aufbewahrt.
        </label>
      </div>
    </div>
  );
}
