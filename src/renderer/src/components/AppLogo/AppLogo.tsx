import logoUrl from '@/assets/logo.svg'

interface AppLogoProps {
  className?: string
}

export default function AppLogo({ className = 'w-8 h-8' }: AppLogoProps) {
  return (
    <img
      src={logoUrl}
      alt="IPTV Mac"
      className={`${className} select-none`}
      draggable={false}
    />
  )
}
