import { memo, useRef, useState, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { IconButton } from '~/components/ui/IconButton';
import { workbenchStore } from '~/lib/stores/workbench';

interface PreviewProps {
  setSelectedElement?: (element: any) => void;
}

/**
 * Preview tab for the Workbench.
 *
 * Before deployment: shows a placeholder prompting the user to deploy.
 * After deployment: loads the deployed resource URL (e.g. https://dad-jokes-api.dexter.cash)
 * in an iframe with an address bar so the user can navigate to paid endpoints
 * and see the x402 paywall in action.
 */
export const Preview = memo(({ setSelectedElement: _setSelectedElement }: PreviewProps) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const deployedUrl = useStore(workbenchStore.deployedUrl);
  const [displayPath, setDisplayPath] = useState('/');
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // When deployedUrl changes, reset to the root
  const currentUrl = iframeUrl || deployedUrl;

  const navigateToPath = useCallback(
    (path: string) => {
      if (!deployedUrl) {
        return;
      }

      let targetPath = path.trim();

      if (!targetPath.startsWith('/')) {
        targetPath = '/' + targetPath;
      }

      const fullUrl = deployedUrl + targetPath;
      setIframeUrl(fullUrl);
      setDisplayPath(targetPath);

      if (inputRef.current) {
        inputRef.current.blur();
      }
    },
    [deployedUrl],
  );

  const reloadPreview = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  const openInNewTab = () => {
    if (currentUrl) {
      window.open(currentUrl, '_blank');
    }
  };

  const toggleFullscreen = async () => {
    if (!isFullscreen && containerRef.current) {
      await containerRef.current.requestFullscreen();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }

    setIsFullscreen(!isFullscreen);
  };

  // No deployed URL yet -- show placeholder
  if (!deployedUrl) {
    return (
      <div ref={containerRef} className="w-full h-full flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center bg-bolt-elements-background-depth-1 text-center px-8">
          <div className="i-ph:rocket-launch text-5xl text-bolt-elements-textTertiary mb-4" />
          <h3 className="text-lg font-medium text-bolt-elements-textPrimary mb-2">
            Deploy your resource to preview it
          </h3>
          <p className="text-sm text-bolt-elements-textSecondary max-w-md leading-relaxed">
            Once Dexter deploys your resource, the live endpoint will appear here. You can navigate to paid endpoints to
            see the x402 paywall in action.
          </p>
        </div>
      </div>
    );
  }

  // Deployed -- show iframe with address bar
  return (
    <div ref={containerRef} className="w-full h-full flex flex-col relative">
      {/* Address bar */}
      <div className="bg-bolt-elements-background-depth-2 p-2 flex items-center gap-2">
        <div className="flex items-center gap-1">
          <IconButton icon="i-ph:arrow-clockwise" onClick={reloadPreview} title="Reload" />
        </div>

        {/* URL bar */}
        <div className="flex-grow flex items-center gap-1 bg-bolt-elements-preview-addressBar-background border border-bolt-elements-borderColor text-bolt-elements-preview-addressBar-text rounded-full px-3 py-1 text-sm hover:bg-bolt-elements-preview-addressBar-backgroundHover focus-within:bg-bolt-elements-preview-addressBar-backgroundActive focus-within:border-bolt-elements-borderColorActive focus-within:text-bolt-elements-preview-addressBar-textActive">
          <span className="text-bolt-elements-textTertiary text-xs truncate max-w-[200px] shrink-0">{deployedUrl}</span>
          <input
            title="Path"
            ref={inputRef}
            className="w-full bg-transparent outline-none"
            type="text"
            value={displayPath}
            onChange={(e) => setDisplayPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                navigateToPath(displayPath);
              }
            }}
            placeholder="/"
          />
        </div>

        <div className="flex items-center gap-1">
          <IconButton icon="i-ph:arrow-square-out" onClick={openInNewTab} title="Open in new tab" />
          <IconButton
            icon={isFullscreen ? 'i-ph:arrows-in' : 'i-ph:arrows-out'}
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          />
        </div>
      </div>

      {/* Iframe */}
      <div className="flex-1 border-t border-bolt-elements-borderColor">
        <iframe
          ref={iframeRef}
          title="Deployed resource preview"
          className="border-none w-full h-full bg-white"
          src={currentUrl || undefined}
          sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
          allow="cross-origin-isolated"
        />
      </div>
    </div>
  );
});
