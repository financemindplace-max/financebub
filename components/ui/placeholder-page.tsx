import { Construction } from 'lucide-react'

interface PlaceholderPageProps {
  title: string
  description?: string
}

export default function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 p-12 text-center shadow-sm">
        <Construction className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Sedang dalam pengembangan</h3>
        <p className="text-xs text-gray-400">{description ?? 'Modul ini akan segera tersedia'}</p>
      </div>
    </div>
  )
}
