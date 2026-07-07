import React from 'react';
import { Label, Box, Text } from '@adminjs/design-system';
import { useTranslation, flat } from 'adminjs';

const JsonArrayList = (props) => {
  const { property, record } = props;
  const { translateProperty } = useTranslation();
  
  // AdminJS flattens nested objects/arrays in record.params (e.g. customCareInstructions.0.care_instruction)
  // We must unflatten it to get the actual array
  const unflattened = flat.unflatten(record.params);
  const value = unflattened[property.name];
  console.log(`JsonArrayList [${property.name}]:`, { value, rawParams: record.params });

  if (!value) {
    return (
      <Box mb="xl">
        <Label>{translateProperty(property.name, property.resourceId)}</Label>
        <Text>NO_VALUE_FOUND | Keys: {JSON.stringify(Object.keys(record.params).filter(k => k.toLowerCase().includes('custom')))}</Text>
      </Box>
    );
  }

  let parsedValue = [];
  try {
    if (typeof value === 'string') {
      parsedValue = JSON.parse(value);
    } else if (Array.isArray(value)) {
      parsedValue = value;
    }
  } catch (e) {
    return (
      <Box mb="xl">
        <Label>{translateProperty(property.name, property.resourceId)}</Label>
        <Text>{String(value)}</Text>
      </Box>
    );
  }

  if (!Array.isArray(parsedValue) || parsedValue.length === 0) {
    return (
      <Box mb="xl">
        <Label>{translateProperty(property.name, property.resourceId)}</Label>
        <Text>-</Text>
      </Box>
    );
  }

  // Find the exact field to display based on the property name
  const propertyMapping = {
    customIncludedComponents: 'included_components',
    customSpecificUsesForProduct: 'title_key',
    customRecommendedUsesForProduct: 'title',
    customSelectMaterial: 'material',
    customRoomType: 'room_type',
    customSpecialFeature: 'special_feature',
    customCareInstructions: 'care_instruction',
    customAmazonBulletPoint: 'bullet_point',
    customPackerContactInformation: 'title_key'
  };

  const displayField = propertyMapping[property.name];

  return (
    <Box mb="xl">
      <Label>{translateProperty(property.name, property.resourceId)}</Label>
      <Box>
        {parsedValue.map((item, index) => {
          let itemText = '';
          if (typeof item === 'object' && item !== null) {
            if (displayField && item[displayField]) {
              itemText = item[displayField];
            } else {
              // Fallback to first non-standard key
              const ignoreKeys = ['name', 'owner', 'creation', 'modified', 'modified_by', 'idx', 'docstatus', 'parent', 'parentfield', 'parenttype', 'doctype'];
              const keys = Object.keys(item).filter(k => !ignoreKeys.includes(k));
              if (keys.length > 0) {
                itemText = item[keys[0]];
              } else {
                itemText = JSON.stringify(item);
              }
            }
          } else {
            itemText = String(item);
          }

          return (
            <Text key={index} style={{ marginBottom: '4px' }}>
              &gt; {itemText}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
};

export default JsonArrayList;
