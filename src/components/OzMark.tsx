export function OzMark({ active = false }: { active?: boolean }) {
  return (
    <div className={`oz-mark${active ? " oz-mark--active" : ""}`} aria-hidden="true">
      <span className="oz-mark__halo" />
      <span className="oz-mark__core">O</span>
    </div>
  );
}
