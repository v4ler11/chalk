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
  wrapClass,
  imageClass,
}: {
  images: string[];
  wrapClass: string;
  imageClass: string;
}) {
  return (
    <div className={wrapClass}>
      {images.map((url, i) => (
        <img key={i} className={imageClass} src={url} alt={`Attached image ${i + 1}`} />
      ))}
    </div>
  );
}
