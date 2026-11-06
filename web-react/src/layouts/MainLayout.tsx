import type { PropsWithChildren, ReactNode, Ref } from 'react';
import './main-layout.css';

export interface MainLayoutProps extends PropsWithChildren {
  sidebar?: ReactNode;
  mobileHeader?: ReactNode;
  topBar?: ReactNode;
  sidebarCollapsed?: boolean;
  contentRef?: Ref<HTMLElement>;
  contentLabel?: string;
}

export default function MainLayout({ children, sidebar, mobileHeader, topBar, sidebarCollapsed = false, contentRef, contentLabel = '图书内容' }: MainLayoutProps) {
  if (!sidebar) return <main>{children}</main>;
  return <div className="main-layout" data-top-bar={!!topBar} data-sidebar-collapsed={sidebarCollapsed}>
    {topBar && <div className="main-layout__top-bar">{topBar}</div>}
    <div className="main-layout__sidebar">{sidebar}</div>
    <main ref={contentRef} className="main-layout__content" aria-label={contentLabel}>
      {mobileHeader && <div className="main-layout__mobile-header">{mobileHeader}</div>}
      {children}
    </main>
  </div>;
}
