import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Compass } from 'lucide-react';

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300">
          <Compass className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Page not found</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">The page you were looking for does not exist or has moved.</p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={() => navigate(-1)} className="btn-secondary">
            <ArrowLeft className="h-4 w-4" /> Go back
          </button>
          <Link to="/app" className="btn-primary">
            Open dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
