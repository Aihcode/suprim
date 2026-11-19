export default function Loading() {
  return (
    <div className="min-h-screen bg-surface-light p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="skeleton h-10 w-64 rounded-lg" />
        <div className="skeleton h-4 w-96 max-w-full rounded" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="skeleton h-28 rounded-xl" />
          ))}
        </div>
        <div className="skeleton h-80 rounded-xl" />
      </div>
    </div>
  );
}
