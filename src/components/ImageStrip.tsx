/**
 * The pictures a prompt was posted with, in the order they were attached: square,
 * cropped to fill, wrapped onto as many rows as they need.
 *
 * The transcript draws them at the size they were sent and a feed row at the size
 * a line of the feed can hold, so the two class names come from the place the
 * strip stands in and only the shape, and what a picture is called, are shared.
 */
export function ImageStrip({
  images,
  count = images.length,
  wrapClass,
  imageClass,
}: {
  images: string[];
  /**
   * How many boxes the strip is to hold, when that is known before the pictures
   * themselves are: a feed row is told how many its prompt was posted with and
   * reads the pictures after it is drawn, so it reserves their boxes rather than
   * growing by them a frame later. The boxes are drawn and empty, and are hidden
   * by their own stylesheet until a picture stands in one.
   */
  count?: number;
  wrapClass: string;
  imageClass: string;
}) {
  const held = Math.max(0, count - images.length);
  return (
    <div className={wrapClass}>
      {images.map((url, i) => (
        <img key={i} className={imageClass} src={url} alt={`Attached image ${i + 1}`} />
      ))}
      {Array.from({ length: held }, (_, i) => (
        <span key={`held-${i}`} className={`${imageClass} held`} />
      ))}
    </div>
  );
}
