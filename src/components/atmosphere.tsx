export function Atmosphere() {
  return (
    <div aria-hidden className="atmosphere pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="atmosphere-wash absolute inset-0" />
      <div className="atmosphere-spot atmosphere-spot-key" />
      <div className="atmosphere-spot atmosphere-spot-gold" />
      <div className="atmosphere-spot atmosphere-spot-pine" />
      <div className="atmosphere-aurora" />
      <div className="atmosphere-ribbon" />
      <div className="grain" />
    </div>
  );
}
