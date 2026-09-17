import type { DrawingTool } from '../app/contracts';
const paths: Record<DrawingTool, string> = {
  select: 'M4 3 19 12 12 13 9 20Z M12 13 17 20',
  path: 'M4 18 10 6 20 11 M3 17h2v2H3Z M9 5h2v2H9Z M19 10h2v2h-2Z',
  area: 'M4 6 17 3 21 16 8 21Z',
  count: 'M12 5v14 M5 12h14 M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  calibrate: 'M3 7h18v10H3Z M7 7v5 M11 7v3 M15 7v5 M19 7v3',
};
export default function ToolIcon(props: { tool: DrawingTool }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={paths[props.tool]} />
    </svg>
  );
}
