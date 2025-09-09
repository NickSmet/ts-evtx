/**
 * System tokens for binary XML parsing.
 */
export enum SystemToken {
    EndOfStreamToken = 0x00,
    OpenStartElementToken = 0x01,
    CloseStartElementToken = 0x02,
    CloseEmptyElementToken = 0x03,
    CloseElementToken = 0x04,
    ValueToken = 0x05,
    AttributeToken = 0x06,
    CDataSectionToken = 0x07,
    EntityReferenceToken = 0x08,
    ProcessingInstructionTargetToken = 0x0a,
    ProcessingInstructionDataToken = 0x0b,
    TemplateInstanceToken = 0x0c,
    NormalSubstitutionToken = 0x0d,
    ConditionalSubstitutionToken = 0x0e,
    StartOfStreamToken = 0x0f,
  }
  
/**
 * Binary XML tokens for the new streaming parser architecture.
 * These correspond to the same values as SystemToken but with cleaner naming.
 */
export enum BXmlToken {
  EndOfStream = 0x00,
  OpenStartElement = 0x01,
  CloseStartElement = 0x02,
  CloseEmptyElement = 0x03,
  CloseElement = 0x04,
  Value = 0x05,
  Attribute = 0x06,
  CDataSection = 0x07,
  EntityReference = 0x08,
  ProcessingInstructionTarget = 0x0a,
  ProcessingInstructionData = 0x0b,
  TemplateInstance = 0x0c,
  NormalSubstitution = 0x0d,
  OptionalSubstitution = 0x0e,
  StartOfStream = 0x0f,
  
  // This is used for NameStringNode which doesn't come from the stream
  Name = 0xff,
  
  // Fragment header token
  FragmentHeader = 0x10,
}
  
/**
 * Variant types for substitution values.
 */
export enum VariantType {
    Null            = 0x00,
    WString         = 0x01,
    String          = 0x02,
    SignedByte      = 0x03,
    UnsignedByte    = 0x04,
    SignedWord      = 0x05,
    UnsignedWord    = 0x06,
    SignedDWord     = 0x07,
    UnsignedDWord   = 0x08,
    SignedQWord     = 0x09,
    UnsignedQWord   = 0x0a,
    Float           = 0x0b,
    Double          = 0x0c,
    Boolean         = 0x0d,
    Binary          = 0x0e,
    Guid            = 0x0f,
    Size            = 0x10,
    FileTime        = 0x11,
    SystemTime      = 0x12,
    Sid             = 0x13,
    Hex32           = 0x14,
    Hex64           = 0x15,
    BXml            = 0x21,
    WStringArray    = 0x81,
}
