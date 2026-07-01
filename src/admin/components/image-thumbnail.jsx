import React from 'react';

const ImageThumbnail = (props) => {
  const { record, property } = props;
  const url = record.params[property.name];

  if (!url) {
    return <span>No image</span>;
  }

  return (
    <div style={{ marginBottom: '1rem' }}>
      <img src={url} alt="Thumbnail" style={{ maxWidth: '200px', maxHeight: '200px', objectFit: 'contain' }} />
    </div>
  );
};

export default ImageThumbnail;
