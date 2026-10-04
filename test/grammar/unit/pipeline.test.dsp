// SYNTAX TEST "source.dreamshader.dsp" "a .dsp: declarations, pass statements, embedded hlsl blocks"
#pragma pipeline(Order = 100, Views = Game | Editor, Injection = PostProcess.AfterTonemap)
// <- meta.preprocessor.pragma.dreamshader punctuation.definition.directive.dreamshader
//      ^^^^^^^^ entity.name.function.preprocessor.dreamshader
//               ^^^^^ variable.other.property.dreamshader
//                       ^^^ constant.numeric.dreamshader
//                            ^^^^^ variable.other.property.dreamshader
//                                    ^^^^ constant.other.enumerator.dreamshader
//                                         ^ keyword.operator.bitwise.dreamshader
//                                                               ^^^^^^^^^^^ constant.other.enumerator.dreamshader
//                                                                          ^ punctuation.accessor.dreamshader
//                                                                           ^^^^^^^^^^^^ constant.other.enumerator.dreamshader

/// @group Look   @slider 1 8
// <--- comment.line.documentation.dreamshader
//   ^^^^^ storage.type.annotation.dreamshader
//                 ^^^^^^ storage.type.annotation.dreamshader
uniform float OutlineWidth = 3.0;
// <------- storage.modifier.dreamshader
//      ^^^^^ storage.type.dreamshader
//            ^^^^^^^^^^^^ entity.name.variable.uniform.dreamshader
static const float Half = 0.5;
//                 ^^^^ variable.other.constant.dreamshader
uniform float buffer = 1.0;
//            ^^^^^^ entity.name.variable.uniform.dreamshader
//            ^^^^^^ - storage.type.buffer.dreamshader

buffer Blurred : RGBA16F(Scale = Half * 0.5, Export = true, Clear = None);
// <------ storage.type.buffer.dreamshader
//     ^^^^^^^ entity.name.variable.buffer.dreamshader
//             ^ punctuation.separator.colon.dreamshader
//               ^^^^^^^ support.type.format.dreamshader
//                       ^^^^^ variable.other.property.dreamshader
//                                           ^^^^^^ variable.other.property.dreamshader
//                                                    ^^^^ constant.language.boolean.dreamshader
//                                                                  ^^^^ constant.other.enumerator.dreamshader
//                                                                       ^ punctuation.terminator.statement.dreamshader

hlsl // the file's block; a comment may stand between `hlsl` and its brace }
// <---- keyword.other.hlsl-block.dreamshader
//   ^^ comment.line.double-slash.dreamshader
{
// <- punctuation.section.block.begin.dreamshader
    #define OPEN {
//  ^^^^^^^ meta.embedded.block.hlsl keyword.preprocessor.hlsl
//               ^ meta.embedded.block.hlsl - punctuation.section.block.begin.hlsl
    static const string Text = "} {";
//                             ^^^^^ meta.embedded.block.hlsl string.quoted.double.hlsl
    struct FTap
//  ^^^^^^ meta.embedded.block.hlsl storage.type.structured.hlsl
    {
//  ^ meta.embedded.block.hlsl punctuation.section.block.begin.hlsl
        float2 Offset;
    };
//  ^ meta.embedded.block.hlsl punctuation.section.block.end.hlsl
    cbuffer FParams
    {
        float4 Tint;
    };
    [numthreads(8, 8, 1)]
//   ^^^^^^^^^^ meta.embedded.block.hlsl support.function.hlsl
    void MainCS(uint3 Id : SV_DispatchThreadID)
//  ^^^^ meta.embedded.block.hlsl storage.type.basic.hlsl
//                         ^^^^^^^^^^^^^^^^^^^ meta.embedded.block.hlsl support.variable.semantic.sm5.hlsl
    {
        const float2 Taps[2] = { float2(0, 1), float2(1, 0) };
        if (Id.x > 0) { return; } /* } */ // }
//                    ^ punctuation.section.block.begin.hlsl
//                                ^^^^^^^ comment.line.block.hlsl
//                                        ^^^^ comment.line.double-slash.hlsl
    }
//  ^ meta.embedded.block.hlsl punctuation.section.block.end.hlsl
}
// <- punctuation.section.block.end.dreamshader - meta.embedded.block.hlsl

/// @desc The text after a block is DreamShader again.
pass Blur : compute
// <---- meta.pass.dreamshader storage.type.pass.dreamshader
//   ^^^^ entity.name.function.pass.dreamshader
//          ^^^^^^^ support.type.pass-kind.dreamshader
{
    Injection = BeginView;
//  ^^^^^^^^^ variable.other.property.dreamshader
//              ^^^^^^^^^ constant.other.enumerator.dreamshader
    Filter = (Layer(Highlight | "Other") | List(Enemies)) & Stencil(4, 0x0F);
//            ^^^^^ support.function.dreamshader
//                  ^^^^^^^^^ constant.other.enumerator.dreamshader
//                              ^^^^^^^ string.quoted.double.dreamshader
//                                                        ^ keyword.operator.bitwise.dreamshader
//                                                                     ^^^^ constant.numeric.hex.dreamshader
    Threads = uint3(8, 8, 1);
//            ^^^^^ storage.type.vector.dreamshader
    read  Source = Field.Previous;
//  ^^^^ keyword.other.binding.dreamshader
//        ^^^^^^ variable.parameter.binding.dreamshader
//                 ^^^^^ variable.other.buffer.dreamshader
//                      ^ punctuation.accessor.dreamshader
//                       ^^^^^^^^ variable.language.previous.dreamshader
    read  Mask.Current;
//        ^^^^ variable.other.buffer.dreamshader
//             ^^^^^^^ invalid.illegal.member.dreamshader
    read write;
//  ^^^^ keyword.other.binding.dreamshader
//       ^^^^^ variable.other.buffer.dreamshader
    write param = Blurred; // trailing
//  ^^^^^ keyword.other.binding.dreamshader
//        ^^^^^ variable.parameter.binding.dreamshader
//                ^^^^^^^ variable.other.buffer.dreamshader
//                         ^^ comment.line.double-slash.dreamshader
    param Radius = OutlineWidth * 2 + 1;
//  ^^^^^ keyword.other.binding.dreamshader
//        ^^^^^^ variable.parameter.binding.dreamshader

    hlsl
//  ^^^^ keyword.other.hlsl-block.dreamshader
    {
//  ^ punctuation.section.block.begin.dreamshader
#if 1
// <--- meta.embedded.block.hlsl keyword.preprocessor.hlsl
        Result[Id.xy] = Source.SampleLevel(DP_LinearClamp, (Id.xy + 0.5) * ResultSize.zw, 0);
//                             ^^^^^^^^^^^ meta.embedded.block.hlsl support.function.hlsl
#endif
    }
//  ^ meta.pass.dreamshader punctuation.section.block.end.dreamshader - meta.embedded.block.hlsl
    Enabled = true;
//  ^^^^^^^ meta.pass.dreamshader variable.other.property.dreamshader - meta.embedded.block.hlsl
}
// <- meta.pass.dreamshader punctuation.section.block.end.dreamshader

pass Single : fullscreen { hlsl { Out = float4(UV, 0, 1); } }
//                         ^^^^ keyword.other.hlsl-block.dreamshader
//                                ^^^ meta.embedded.block.hlsl
//                                                        ^ punctuation.section.block.end.dreamshader - meta.embedded.block.hlsl
//                                                          ^ meta.pass.dreamshader punctuation.section.block.end.dreamshader

pass Missing : compute
    Injection = AfterOpaque;
//  ^^^^^^^^^ - variable.other.property.dreamshader
buffer After : R8;
// <------ storage.type.buffer.dreamshader
