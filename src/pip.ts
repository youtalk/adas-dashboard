// Camera picture-in-picture (design section 6.1): an <iframe> of the raw camera
// stream at the top right. Key c or the close button minimizes it to a small
// camera button, and a click on that button restores it. The page draws nothing
// on top of the camera image, except the close button and "camera lost" (design
// section 6.3).

const PROBE_TIMEOUT_MS = 3000;
const PROBE_RETRY_MS = 5000;

export class CameraPip {
  private box = document.getElementById("pip") as HTMLElement;
  private frame = document.getElementById("pip-frame") as HTMLIFrameElement;
  private lostEl = document.getElementById("pip-lost") as HTMLElement;
  private minEl = document.getElementById("pip-min") as HTMLElement;
  private closeEl = document.getElementById("pip-close") as HTMLElement;
  private url = "";
  private reachable = false;
  private stackLost = false;
  private minimized = false;

  constructor() {
    this.closeEl.addEventListener("click", () => this.toggleMinimized());
    this.minEl.addEventListener("click", () => this.toggleMinimized());
  }

  start(url: string): void {
    this.url = url;
    this.render();
    if (url) this.probe();
  }

  toggleMinimized(): void {
    this.minimized = !this.minimized;
    this.render();
  }

  // Stack lost: keep the last frame and say "camera lost" (design section 6.3).
  setStackLost(lost: boolean): void {
    if (lost === this.stackLost) return;
    this.stackLost = lost;
    // The camera stream restarts with the stack and its server may listen a
    // little later, so go back through the probe instead of loading at once.
    // A probe that is still retrying already covers it.
    if (!lost && this.reachable) {
      this.reachable = false;
      this.probe();
    }
    this.render();
  }

  // Load the iframe only once the camera server answers. A dead port would
  // otherwise show the browser's error page inside the PiP.
  private probe(): void {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    fetch(this.url, { mode: "no-cors", cache: "no-store", signal: ctrl.signal })
      .then(() => {
        clearTimeout(timer);
        ctrl.abort(); // headers are enough; do not download a stream body
        this.reachable = true;
        this.frame.src = this.url;
        this.render();
      })
      .catch(() => {
        clearTimeout(timer);
        setTimeout(() => this.probe(), PROBE_RETRY_MS);
      });
  }

  private render(): void {
    this.box.hidden = this.minimized;
    this.minEl.hidden = !this.minimized;
    const lost = this.stackLost || !this.reachable;
    this.lostEl.hidden = !lost;
    this.frame.hidden = !this.reachable;
    this.box.classList.toggle("lost", lost);
  }
}
