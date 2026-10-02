import Dialog, { DialogFooter } from '@/components/Dialog/Dialog'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  confirmVariant?: 'danger' | 'primary'
  loading?: boolean
}

/**
 * 确认弹窗
 * 参考：FongMi TV 的 MaterialAlertDialogBuilder 简单确认
 */
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = '确认',
  confirmVariant = 'danger',
  loading = false
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title} width="max-w-sm">
      <p className="text-sm text-text-secondary leading-6">{message}</p>
      <DialogFooter align="end">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded-lg border border-[#2a2a2a] text-text-secondary hover:text-text-primary transition-colors"
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors disabled:opacity-50 ${
            confirmVariant === 'danger'
              ? 'bg-red-600 text-white hover:bg-red-500'
              : 'bg-accent text-bg-primary hover:bg-accent-hover'
          }`}
        >
          {loading ? '处理中...' : confirmLabel}
        </button>
      </DialogFooter>
    </Dialog>
  )
}