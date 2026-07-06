'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Download, Edit } from 'lucide-react'
import type { Doc } from '@/types/document'
import { fetchGlobal } from '@/lib/rtdb'
import {
  buildLegacyPreviewHtml,
  downloadLegacyDocumentPdf,
  prepareLegacyDocumentData,
} from '@/lib/legacy-document-pdf'

interface Props {
  doc: Doc
  onBack: () => void
  onEdit: () => void
}

export default function InvoicePreview({ doc, onBack, onEdit }: Props) {
  const [global, setGlobal] = useState<Record<string, unknown>>({})
  const [downloading, setDownloading] = useState(false)
  const [downloadingWet, setDownloadingWet] = useState(false)

  useEffect(() => {
    fetchGlobal().then(data => setGlobal((data || {}) as Record<string, unknown>))
  }, [])

  const previewData = useMemo(() => prepareLegacyDocumentData(doc, 'invoice', global), [doc, global])
  const previewHtml = useMemo(() => buildLegacyPreviewHtml(previewData), [previewData])

  const handleDownloadPdf = async () => {
    setDownloading(true)
    try {
      await downloadLegacyDocumentPdf(previewData)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Gagal membuat PDF')
    } finally {
      setDownloading(false)
    }
  }

  const handleDownloadWet = async () => {
    setDownloadingWet(true)
    try {
      await downloadLegacyDocumentPdf(previewData, { skipSignature: true })
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Gagal membuat PDF')
    } finally {
      setDownloadingWet(false)
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-100">
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900">
            <ArrowLeft className="w-4 h-4" />
            Kembali
          </button>
          <span className="text-gray-300">|</span>
          <h1 className="text-sm font-semibold text-gray-900">Preview — {previewData.fields['i-no'] || 'Invoice'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
            <Edit className="w-3.5 h-3.5" />
            Edit
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={downloading}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#185FA5] hover:bg-[#0F4A85] disabled:opacity-60 text-white text-sm font-semibold rounded-lg"
            title={`${previewData.fileName}.pdf`}
          >
            <Download className="w-3.5 h-3.5" />
            {downloading ? 'Membuat PDF...' : 'Download PDF'}
          </button>
          <button
            onClick={handleDownloadWet}
            disabled={downloadingWet}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-600 hover:bg-gray-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg"
            title={`${previewData.fileName} (TTD Basah).pdf`}
          >
            <Download className="w-3.5 h-3.5" />
            {downloadingWet ? 'Membuat PDF...' : 'TTD Basah'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="bg-gray-400 rounded-xl p-6 flex justify-center overflow-x-auto">
          <div
            style={{
              background: '#fff',
              color: '#1a1a1a',
              padding: '22px 26px 20px',
              borderRadius: 4,
              fontFamily: 'Helvetica, Arial, sans-serif',
              fontSize: 10,
              lineHeight: 1.5,
              width: 570,
              minHeight: 806,
              boxShadow: '0 2px 12px rgba(0,0,0,.18)',
            }}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      </div>
    </div>
  )
}
