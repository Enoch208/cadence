import { toneText, type Tone } from "@/components/ui/tones";

export type Tile = { label: string; value: string; tone: Tone };

export function SummaryTiles({ tiles }: { tiles: readonly Tile[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <li
          key={tile.label}
          className="flex flex-col gap-2 rounded-card border border-ink bg-paper p-5"
        >
          <span className={`t-numeral text-[40px] tabular-nums ${toneText[tile.tone]}`}>
            {tile.value}
          </span>
          <span className="t-body leading-tight">{tile.label}</span>
        </li>
      ))}
    </ul>
  );
}
